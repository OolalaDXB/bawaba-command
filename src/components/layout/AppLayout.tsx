import { useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { BarChart3, Shield, Scale, ScrollText, Fingerprint, Globe, Layers, Settings, Pin, PinOff } from 'lucide-react';
import { useTheme, THEME_LABELS, type Theme } from '@/hooks/use-theme';

const navItems = [
  { path: '/dashboard', label: 'Dashboard', icon: BarChart3 },
  { path: '/scenarios', label: 'Scenarios', icon: BarChart3 },
  { path: '/agents', label: 'Agents', icon: Shield },
  { path: '/policy', label: 'Policy', icon: Scale },
  { path: '/audit', label: 'Audit Trail', icon: ScrollText },
  { path: '/pii', label: 'PII', icon: Fingerprint },
  { path: '/routing', label: 'Sovereign Routing', icon: Globe },
  { path: '/architecture', label: 'Architecture', icon: Layers },
];

export default function AppLayout() {
  const location = useLocation();
  const { theme, setTheme, themes } = useTheme();
  const currentPage = location.pathname === '/settings' ? 'Settings' : (
    navItems.find(item =>
      item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path)
    )?.label || 'Dashboard'
  );

  const [pinned, setPinned] = useState(() => typeof window !== 'undefined' && localStorage.getItem('bawaba-sidebar-pinned') === '1');
  const togglePin = () => {
    setPinned(p => {
      localStorage.setItem('bawaba-sidebar-pinned', p ? '0' : '1');
      return !p;
    });
  };
  // Pinned = expanded and pushing content; unpinned = icon rail that expands
  // on hover as an overlay. The margin transition is the bridge between the
  // two modes.
  const labelCls = pinned ? 'opacity-100' : 'opacity-0 group-hover/sidebar:opacity-100';

  return (
    <div className="flex min-h-screen bg-background" style={{ minWidth: 1280 }}>
      {/* Sidebar */}
      <nav className={`group/sidebar fixed left-0 top-0 h-full transition-all duration-300 ease-in-out bg-card border-r border-border z-50 flex flex-col overflow-hidden ${pinned ? 'w-56' : 'w-14 hover:w-56'}`}>
        {/* Logo */}
        <div className="h-14 flex items-center px-4 border-b border-border shrink-0">
          <span className="font-heading text-xl font-light whitespace-nowrap" style={{ letterSpacing: '3px' }}>
            B<span className={`inline transition-opacity duration-300 ${labelCls}`}>AWABA</span>
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
              <span className={`transition-opacity duration-300 text-xs tracking-wide ${labelCls}`}>
                {item.label}
              </span>
            </NavLink>
          ))}
        </div>

        {/* Bottom */}
        <div className="border-t border-border py-3">
          <button
            onClick={togglePin}
            title={pinned ? 'Unpin sidebar (hover to expand)' : 'Pin sidebar expanded'}
            className="flex items-center gap-3 px-4 h-10 w-full text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
          >
            {pinned ? <PinOff className="h-4 w-4 shrink-0" strokeWidth={1.5} /> : <Pin className="h-4 w-4 shrink-0" strokeWidth={1.5} />}
            <span className={`transition-opacity duration-300 text-xs tracking-wide whitespace-nowrap ${labelCls}`}>
              {pinned ? 'Unpin menu' : 'Pin menu open'}
            </span>
          </button>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 h-10 w-full transition-colors ${
                isActive
                  ? 'text-foreground bg-secondary font-medium border-r-2 border-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
              }`
            }
          >
            <Settings className="h-4 w-4 shrink-0" strokeWidth={1.5} />
            <span className={`transition-opacity duration-300 text-xs tracking-wide whitespace-nowrap ${labelCls}`}>
              Settings
            </span>
          </NavLink>
        </div>
      </nav>

      {/* Main content area */}
      <div className={`flex-1 transition-[margin] duration-300 ${pinned ? 'ml-56' : 'ml-14'}`}>
        {/* Top bar */}
        <header className="h-14 border-b border-border flex items-center px-6 bg-card sticky top-0 z-40">
          <div className="flex items-center gap-2">
            <span className="font-heading text-xl font-light text-foreground" style={{ letterSpacing: '3px' }}>BAWABA</span>
            <span className="text-ink-4 text-xs">·</span>
            <span className="font-heading text-xl font-light" style={{ direction: 'rtl', letterSpacing: '2px' }}>بوابة</span>
          </div>

          <div className="flex-1 flex justify-center">
            <span className="text-xs tracking-widest uppercase text-muted-foreground font-body font-medium">
              {currentPage}
            </span>
          </div>

          <div className="flex items-center gap-4">
            <select className="text-xs bg-transparent border border-border rounded px-2 py-1 text-muted-foreground font-body">
              <option>Atlas Commercial Bank · Demo</option>
            </select>
            <select
              value={theme}
              onChange={e => setTheme(e.target.value as Theme)}
              aria-label="Theme"
              className="text-xs bg-transparent border border-border rounded px-2 py-1 text-muted-foreground font-body"
            >
              {themes.map(t => (
                <option key={t} value={t}>{THEME_LABELS[t]}</option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-medium">
                MT
              </div>
              <span className="text-xs text-muted-foreground font-body">Mickael Thomas</span>
            </div>
          </div>
        </header>

        {/* Demo environment banner */}
        <div className="border-b border-border bg-secondary/40 px-6 py-1.5 text-center">
          <span className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground font-body">
            Demonstration Environment · Simulated Tenants, Events and Volumes · No Customer Data
          </span>
        </div>

        {/* Page content */}
        <main className="p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
