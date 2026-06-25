'use client';

import React from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';

export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();

  const tabs = [
    { label: '프로젝트 홈', href: `/project/${id}` },
    { label: '대시보드', href: `/project/${id}/dashboard` },
    { label: '내 체크리스트', href: `/project/${id}/checklist` },
  ];

  return (
    <div className="flex flex-col gap-0">
      {/* 탭 네비게이션 */}
      <nav className="flex gap-0 border-b border-gray-100 mb-8">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-400 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
