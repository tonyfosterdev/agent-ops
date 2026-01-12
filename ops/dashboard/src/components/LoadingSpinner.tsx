/**
 * LoadingSpinner - Reusable animated spinner component.
 */

interface LoadingSpinnerProps {
  /** Size of the spinner: 'sm' (16px), 'md' (20px) */
  size?: 'sm' | 'md';
  /** Additional CSS classes */
  className?: string;
}

export function LoadingSpinner({ size = 'md', className = '' }: LoadingSpinnerProps) {
  const sizeClasses = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';

  return (
    <svg
      className={`animate-spin ${sizeClasses} ${className}`}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}
