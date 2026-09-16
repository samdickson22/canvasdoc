import {
  BookOpen,
  CalendarDays,
  ChevronRight,
  CircleHelp,
  Inbox,
  LayoutDashboard,
  PanelsTopLeft,
  UserCircle,
} from "lucide-react";
import type { Course } from "./types";
import { courseColors } from "./todo-panel";
export function Navigation({ courses }: { courses: Course[] }) {
  const links = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/profile", label: "Account", icon: UserCircle },
    { href: "/courses", label: "Courses", icon: BookOpen },
    { href: "/calendar", label: "Calendar", icon: CalendarDays },
    { href: "/conversations", label: "Inbox", icon: Inbox },
  ];
  return (
    <nav className="bc-nav" aria-label="Canvas navigation">
      <a className="bc-brand" href="/" aria-label="Canvasdoc home" title="Canvasdoc home">
        <PanelsTopLeft size={22} />
        <strong>Canvasdoc</strong>
      </a>
      <span className="bc-nav-label">Pages</span>
      <div className="bc-nav-pages">
        {links.map(({ href, label, icon: Icon }) => (
          <a
            href={href}
            key={href}
            title={label}
            aria-label={label}
            aria-current={(location.pathname === href || (href !== "/" && location.pathname.startsWith(href + "/"))) ? "page" : undefined}
          >
            <Icon size={19} />
            <span>{label}</span>
          </a>
        ))}
      </div>
      <span className="bc-nav-label">Courses</span>
      <div className="bc-nav-courses">
        {courses.map((c) => (
          <a href={`/courses/${c.id}`} key={c.id} title={c.name} aria-label={c.name} aria-current={location.pathname.startsWith(`/courses/${c.id}/`) || location.pathname === `/courses/${c.id}` ? "page" : undefined}>
            <i
              style={{ background: courseColors[c.id % courseColors.length] }}
            />
            <span>{c.course_code}</span>
            <ChevronRight size={15} />
          </a>
        ))}
      </div>
      <a className="bc-nav-help" href="/profile/settings" title="Settings & help" aria-label="Settings & help">
        <CircleHelp size={18} />
        <span>Settings & help</span>
      </a>
    </nav>
  );
}
