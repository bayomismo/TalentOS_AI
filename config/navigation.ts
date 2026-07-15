import {
  BotIcon,
  CalendarIcon,
  ClipboardListIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  LibraryIcon,
  SettingsIcon,
  TrendingUpIcon,
  UsersIcon,
  BriefcaseIcon,
  type LucideIcon,
} from 'lucide-react'

export type NavItem = {
  label: string
  href: string
  icon: LucideIcon
  title: string
}

export const navItems: NavItem[] = [
  {
    label: 'AI Recruiter',
    href: '/ai-recruiter',
    icon: BotIcon,
    title: 'AI Recruiter',
  },
  {
    label: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboardIcon,
    title: 'Recruitment Dashboard',
  },
  {
    label: 'Hiring Requests',
    href: '/hiring-requests',
    icon: ClipboardListIcon,
    title: 'Hiring Requests',
  },
  {
    label: 'Job Library',
    href: '/job-library',
    icon: LibraryIcon,
    title: 'Job Library',
  },
  {
    label: 'Candidates',
    href: '/candidates',
    icon: UsersIcon,
    title: 'Candidates',
  },
  {
    label: 'Interview Center',
    href: '/interview-center',
    icon: CalendarIcon,
    title: 'Interview Center',
  },
  {
    label: 'Offers',
    href: '/offers',
    icon: BriefcaseIcon,
    title: 'Offers',
  },
  {
    label: 'Analytics',
    href: '/analytics',
    icon: TrendingUpIcon,
    title: 'Analytics',
  },
  {
    label: 'Reports',
    href: '/reports',
    icon: FileTextIcon,
    title: 'Reports',
  },
  {
    label: 'Settings',
    href: '/settings',
    icon: SettingsIcon,
    title: 'Settings',
  },
]

export function getNavItemByHref(href: string): NavItem | undefined {
  if (href.startsWith('/candidates/')) {
    return navItems.find(item => item.href === '/candidates')
  }

  return navItems.find(
    item => item.href === href || (item.href !== '/' && href.startsWith(item.href))
  )
}

export function getPageTitle(pathname: string): string {
  if (pathname.startsWith('/candidates/')) {
    return 'Candidate Profile'
  }

  return getNavItemByHref(pathname)?.title ?? 'TalentOS'
}
