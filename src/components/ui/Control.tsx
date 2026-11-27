import type { ComponentProps } from 'react';

export function Control({ className = '', type = 'button', ...props }: ComponentProps<'button'>) {
  return <button type={type} className={`ds-control ${className}`} {...props} />;
}
