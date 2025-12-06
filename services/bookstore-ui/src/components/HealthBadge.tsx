import React from 'react';

interface HealthBadgeProps {
  status: 'HEALTHY' | 'OFFLINE';
}

const HealthBadge: React.FC<HealthBadgeProps> = ({ status }) => {
  const isHealthy = status === 'HEALTHY';

  return (
    <span style={isHealthy ? styles.healthy : styles.offline}>
      {isHealthy ? '● HEALTHY' : '● OFFLINE'}
    </span>
  );
};

const styles: Record<string, React.CSSProperties> = {
  healthy: {
    color: '#27ae60',
    fontWeight: 'bold',
    fontSize: '0.875rem',
  },
  offline: {
    color: '#e74c3c',
    fontWeight: 'bold',
    fontSize: '0.875rem',
  },
};

export default HealthBadge;
