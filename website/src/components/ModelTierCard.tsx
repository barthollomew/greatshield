import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './ui/card';
import { Badge } from './ui/badge';
import CodeBlock from './CodeBlock';
import { cn } from '../lib/utils';

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
    <Card className={cn(
      'h-full transition-all duration-200',
      recommended && 'ring-2 ring-accent ring-offset-2 shadow-lg'
    )}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-lg">
          <span>{title}</span>
          {recommended && (
            <Badge variant="default" className="ml-2">
              Recommended
            </Badge>
          )}
        </CardTitle>
        <CardDescription className="text-textMuted">
          {subtitle}
        </CardDescription>
      </CardHeader>
      
      <CardContent className="flex-1 space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="font-medium text-accent">RAM:</span>
            <span className="ml-2 text-text">{ramUsage}</span>
          </div>
          {latency && (
            <div>
              <span className="font-medium text-accent">Latency:</span>
              <span className="ml-2 text-text">{latency}</span>
            </div>
          )}
        </div>
        
        <div>
          <h4 className="font-medium text-text mb-2">Features:</h4>
          <ul className="text-sm text-textMuted space-y-1">
            {features.map((feature, index) => (
              <li key={index} className="flex items-start">
                <span className="text-accent mr-2">•</span>
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
      
      <CardFooter className="pt-0">
        <div className="w-full">
          <p className="text-xs font-medium text-textMuted mb-2 uppercase tracking-wide">
            Use with Ollama:
          </p>
          <CodeBlock copyable={true}>
            {`ollama pull ${modelName}`}
          </CodeBlock>
        </div>
      </CardFooter>
    </Card>
  );
}

export default ModelTierCard;