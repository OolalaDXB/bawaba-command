import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { BarChart3, Shield, Scale, ScrollText, Fingerprint, Globe, Settings } from 'lucide-react';

const navItems = [
  { path: '/', label: 'Dashboard', icon: BarChart3 },
  { path: '/agents', label: 'Agents', icon: Shield },
  { path: '/policy', label: 'Policy', icon: Scale },
  { path: '/audit', label: 'Audit Trail', icon: ScrollText },
  { path: '/pii', label: 'PII', icon: Fingerprint },
  { path: '/routing', label: 'Routing', icon: Globe },
];

export default function AppLayout() {
  const location = useLocation();
  const currentPage = navItems.find(item =>
    item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path)
  )?.label || 'Dashboard';

  return (
    <div className="flex min-h-screen bg-background" style={{ minWidth: 1280 }}>
      {/* Sidebar */}
      <nav className="group/sidebar fixed left-0 top-0 h-full w-14 hover:w-56 transition-all duration-300 ease-in-out bg-card border-r border-border z-50 flex flex-col overflow-hidden">
        {/* Logo */}
        <div className="h-14 flex items-center px-4 border-b border-border shrink-0">
          <span className="font-heading text-lg tracking-wide whitespace-nowrap">
            B<span className="inline opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-300">AWABA</span>
          </span>
        </div>

        {/* Nav items */}
        <div className="flex-1 py-3 flex flex-col gap-0.5">
          {navItems.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 h-10 text-sm transition-colors whitespace-nowrap ${
                  isActive
                    ? 'text-foreground bg-secondary font-medium border-r-2 border-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                }`
              }
            >
              <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
              <span className="opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-300 text-xs tracking-wide">
                {item.label}
              </span>
            </NavLink>
          ))}
        </div>

        {/* Bottom */}
        <div className="border-t border-border py-3">
          <button className="flex items-center gap-3 px-4 h-10 w-full text-muted-foreground hover:text-foreground transition-colors">
            <Settings className="h-4 w-4 shrink-0" strokeWidth={1.5} />
            <span className="opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-300 text-xs tracking-wide whitespace-nowrap">
              Settings
            </span>
          </button>
        </div>
      </nav>

      {/* Main content area */}
      <div className="flex-1 ml-14">
        {/* Top bar */}
        <header className="h-14 border-b border-border flex items-center px-6 bg-card sticky top-0 z-40">
          <div className="flex items-center gap-2">
            <span className="font-heading text-base tracking-wide text-foreground">BAWABA</span>
            <span className="text-ink-4 text-xs">·</span>
            <span className="font-heading text-base" style={{ direction: 'rtl' }}>بوابة</span>
          </div>

          <div className="flex-1 flex justify-center">
            <span className="text-xs tracking-widest uppercase text-muted-foreground font-body font-medium">
              {currentPage}
            </span>
          </div>

          <div className="flex items-center gap-4">
            <select className="text-xs bg-transparent border border-border rounded px-2 py-1 text-muted-foreground font-body">
              <option>Al Maghrib Bank</option>
            </select>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-medium">
                MT
              </div>
              <span className="text-xs text-muted-foreground font-body">Mickaël Thomas</span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
