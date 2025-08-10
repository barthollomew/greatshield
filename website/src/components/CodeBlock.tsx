import React, { useState } from 'react';

interface CodeBlockProps {
  children: string;
  language?: string;
  copyable?: boolean;
}

export function CodeBlock({ children, language = '', copyable = true }: CodeBlockProps) {
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
    <div className="relative card rounded-sm p-0 overflow-hidden">
      <pre className={`p-4 overflow-x-auto text-sm ${language ? `language-${language}` : ''}`}>
        <code className="font-mono">{children}</code>
      </pre>
      {copyable && (
        <button
          onClick={handleCopy}
          className="absolute top-2 right-2 px-2 py-1 text-xs border border-border hover:border-border-hover bg-background/80 transition-colors rounded-sm focus:outline-none focus:ring-1 focus:ring-accent"
          aria-label="Copy code"
        >
          {copied ? 'COPIED' : 'COPY'}
        </button>
      )}
    </div>
  );
}

export default CodeBlock;