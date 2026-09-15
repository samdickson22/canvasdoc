require "json"

abort "Development only" unless Rails.env.development?
abort "Unexpected database" unless ActiveRecord::Base.connection.select_value("SELECT current_database()") == "canvas_development"
account = Account.default
abort "Unexpected account" unless account.name == "Canvasdoc Development"

make_user = lambda do |name, email, password|
  pseudonym = account.pseudonyms.find_by(unique_id: email)
  next pseudonym.user if pseudonym

  user = User.create!(name: name)
  user.accept_terms
  user.register!
  channel = user.communication_channels.create!(path: email, path_type: "email", workflow_state: "active")
  pseudonym = account.pseudonyms.build(user: user, unique_id: email, password: password, password_confirmation: password)
  pseudonym.communication_channel = channel
  pseudonym.save!
  user
end

student = make_user.call("Canvasdoc Test Student", "student@canvasdoc.invalid", ENV.fetch("CANVASDOC_STUDENT_PASSWORD"))
teacher = make_user.call("Canvasdoc Test Teacher", "teacher@canvasdoc.invalid", ENV.fetch("CANVASDOC_TEACHER_PASSWORD"))

fixtures = [
  ["CS101", "Introduction to Programming", ["Build a small calculator", "Explain a loop", "Practice functions"]],
  ["DB201", "Database Fundamentals", ["Design a library database", "Practice SQL joins", "Review table relationships"]],
  ["WR101", "Writing and Research", ["Outline a short essay", "Evaluate two sources", "Write a reflection"]]
]

courses = fixtures.map.with_index do |(code, title, titles), course_index|
  course = account.courses.find_by(course_code: "DEV-#{code}")
  unless course
    course = account.courses.create!(name: "[DEV] #{title}", course_code: "DEV-#{code}", is_public: false)
    course.offer!
  end
  [[student, "StudentEnrollment"], [teacher, "TeacherEnrollment"]].each do |user, type|
    enrollment = course.enroll_user(user, type)
    enrollment.update!(workflow_state: "active") unless enrollment.workflow_state == "active"
  end

  assignments = titles.map.with_index do |title, index|
    assignment = course.assignments.find_by(title: title)
    unless assignment
      assignment = course.assignments.create!(
        title: title,
        description: "<p>This is synthetic coursework for Canvasdoc development.</p><p>Explain your approach, include an example, and review your work before submitting.</p>",
        points_possible: 10,
        submission_types: "online_text_entry,online_upload",
        due_at: (index == 1 ? 2.days.ago : (course_index + index + 1).days.from_now),
        workflow_state: "published"
      )
    end
    if index == 2 && assignment.submission_for_student(student).submission_type.nil?
      assignment.submit_homework(student, submission_type: "online_text_entry", body: "Synthetic submission for development tests.")
    end
    {id: assignment.id, title: assignment.title}
  end

  unless course.wiki_pages.find_by(title: "Development course guide")
    course.wiki_pages.create!(title: "Development course guide", body: "<p>Welcome to the Canvasdoc development course. All people, assignments, and submissions here are synthetic.</p>", workflow_state: "active")
  end
  {id: course.id, name: course.name, assignments: assignments}
end

result = {origin: ENV.fetch("CANVASDOC_ORIGIN", "http://localhost:3210"), student_id: student.id, teacher_id: teacher.id, courses: courses}
File.write("/opt/canvasdoc/state/fixtures.json", JSON.pretty_generate(result))
puts JSON.generate(result)
