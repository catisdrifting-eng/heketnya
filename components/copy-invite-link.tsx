'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function CopyInviteLink({ inviteLink }: { inviteLink: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: select input
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
        <span className="flex-1 truncate text-sm text-gray-600 font-mono">
          {inviteLink}
        </span>
        <Button
          size="sm"
          variant={copied ? 'default' : 'outline'}
          onClick={handleCopy}
          className="shrink-0"
        >
          {copied ? '복사됨! ✓' : '복사'}
        </Button>
      </div>
    </div>
  );
}
