import { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import type { Page } from '../i18n';

interface LayoutProps {
  children: ReactNode;
  currentPage: Page;
  onPageChange: (page: Page) => void;
}

export function Layout({ children, currentPage, onPageChange }: LayoutProps) {
  return (
    <div className="app-layout">
      <Sidebar currentPage={currentPage} onPageChange={onPageChange} />
      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
