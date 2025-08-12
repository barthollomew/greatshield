import React, { useState } from 'react';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

interface CodeBlockProps {
  children: string;
  language?: string;
  copyable?: boolean;
  className?: string;
}

export function CodeBlock({ children, language = '', copyable = true, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className={cn("relative bg-muted rounded-lg overflow-hidden", className)}>
      <pre className="p-4 overflow-x-auto text-sm bg-muted">
        <code className="font-mono text-text">{children}</code>
      </pre>
      {copyable && (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="absolute top-2 right-2 text-xs h-7 px-2"
          aria-label="Copy code"
        >
          {copied ? 'Copied!' : 'Copy'}
        </Button>
      )}
    </div>
  );
}

export default CodeBlock;