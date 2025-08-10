import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
}

export function Card({ children, className = '', hover = true }: CardProps) {
  return (
    <div 
      className={`
        card rounded-sm p-6
        ${hover ? 'hover:border-border-hover' : ''}
        ${className}
      `}
    >
      {children}
    </div>
  );
}

export default Card;