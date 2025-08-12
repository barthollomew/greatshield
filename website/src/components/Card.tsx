import React from 'react';
import { Card as ShadcnCard } from './ui/card';
import { cn } from '../lib/utils';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
}

export function Card({ children, className = '', hover = true }: CardProps) {
  return (
    <ShadcnCard 
      className={cn(
        'p-6 transition-colors duration-200',
        hover && 'hover:shadow-md',
        className
      )}
    >
      {children}
    </ShadcnCard>
  );
}

export default Card;