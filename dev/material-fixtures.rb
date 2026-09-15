abort "Development only" unless Rails.env.development? && Account.default.name == "Canvasdoc Development"
course = Account.default.courses.find_by!(course_code: "DEV-CS101")
course.update!(syllabus_body: "<h2>Development syllabus</h2><p>Synthetic material sync fixture.</p>")
attachment = course.attachments.find_by(display_name: "material-sync-notes.txt")
if !attachment || !File.exist?(attachment.full_filename)
  upload = StringIO.new("Canvasdoc material fixture v1\nA loop repeats a block of code.\n")
  def upload.original_filename; "material-sync-notes.txt"; end
  def upload.content_type; "text/plain"; end
  attachment ||= course.attachments.build(folder: Folder.root_folders(course).first, display_name: "material-sync-notes.txt")
  attachment.uploaded_data = upload
  attachment.save!
end
page = course.wiki_pages.find_or_initialize_by(title: "Material sync guide")
page.updating_user = course.teachers.first
page.body = "<h2>Loop reference</h2><p>Read the <a href='/courses/#{course.id}/files/#{attachment.id}/download'>lecture notes</a>.</p>"
page.workflow_state = "active"
page.save!
assignment = course.assignments.find_by!(title: "Explain a loop")
assignment.updating_user = course.teachers.first
unless assignment.description.include?("material-sync-reference")
 assignment.update!(description: assignment.description + "<p id='material-sync-reference'>Reference: <a href='/courses/#{course.id}/files/#{attachment.id}/download'>loop lecture notes</a>.</p>")
end
mod = course.context_modules.find_or_create_by!(name: "Material sync examples")
mod.add_item(id: attachment.id, type: "attachment") unless mod.content_tags.where(content_id: attachment.id, content_type: "Attachment").exists?
mod.add_item(id: page.id, type: "wiki_page") unless mod.content_tags.where(content_id: page.id, content_type: "WikiPage").exists?
puts({course:course.id,file:attachment.id,page:page.id,module:mod.id}.to_json)
