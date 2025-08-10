import React from 'react';
import Card from './Card';
import CodeBlock from './CodeBlock';

interface ModelTierCardProps {
  title: string;
  subtitle: string;
  ramUsage: string;
  latency?: string;
  features: string[];
  modelName: string;
  recommended?: boolean;
}

export function ModelTierCard({ 
  title, 
  subtitle, 
  ramUsage, 
  latency, 
  features, 
  modelName,
  recommended = false 
}: ModelTierCardProps) {
  return (
    <Card className={`h-full ${recommended ? 'border-accent' : ''}`}>
      <div className="flex flex-col h-full">
        <div className="mb-4">
          <h3 className="text-lg font-semibold mb-1">
            {title}
            {recommended && (
              <span className="ml-2 text-xs text-accent font-normal uppercase tracking-wide">
                Recommended
              </span>
            )}
          </h3>
          <p className="text-foreground/70 text-sm">{subtitle}</p>
        </div>
        
        <div className="space-y-2 mb-4 flex-1">
          <div className="text-sm">
            <span className="text-accent">RAM:</span> {ramUsage}
          </div>
          {latency && (
            <div className="text-sm">
              <span className="text-accent">Latency:</span> {latency}
            </div>
          )}
          
          <ul className="text-sm space-y-1 mt-3">
            {features.map((feature, index) => (
              <li key={index} className="text-foreground/80">
                • {feature}
              </li>
            ))}
          </ul>
        </div>
        
        <div className="mt-auto">
          <div className="text-xs text-foreground/60 mb-2 uppercase tracking-wide">
            Use with Ollama:
          </div>
          <CodeBlock copyable={true}>
            {`ollama pull ${modelName}`}
          </CodeBlock>
        </div>
      </div>
    </Card>
  );
}

export default ModelTierCard;