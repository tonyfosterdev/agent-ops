import React from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import type { Book } from '../services/types';

const Purchase: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const book = location.state?.book as Book | undefined;

  if (!book) {
    return (
      <div style={styles.container}>
        <div style={styles.error}>No purchase information available.</div>
        <Link to="/catalog" style={styles.link}>
          Return to Catalog
        </Link>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.successCard}>
        <div style={styles.icon}>✓</div>
        <h1 style={styles.title}>Purchase Successful!</h1>
        <div style={styles.details}>
          <p style={styles.message}>
            You purchased <strong>{book.title}</strong> for{' '}
            <strong>${book.price.toFixed(2)}</strong>
          </p>
          <div style={styles.bookInfo}>
            <p>
              <strong>Author:</strong> {book.author}
            </p>
            <p>
              <strong>ISBN:</strong> {book.isbn}
            </p>
          </div>
        </div>
        <div style={styles.actions}>
          <button onClick={() => navigate('/catalog')} style={styles.button}>
            Continue Shopping
          </button>
          <button onClick={() => navigate('/orders')} style={styles.buttonSecondary}>
            View My Orders
          </button>
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '2rem',
    maxWidth: '600px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 'calc(100vh - 200px)',
  },
  successCard: {
    backgroundColor: 'white',
    borderRadius: '8px',
    padding: '3rem',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
    textAlign: 'center',
    width: '100%',
  },
  icon: {
    fontSize: '4rem',
    color: '#27ae60',
    marginBottom: '1rem',
  },
  title: {
    color: '#2c3e50',
    marginBottom: '2rem',
  },
  details: {
    marginBottom: '2rem',
    textAlign: 'left',
  },
  message: {
    fontSize: '1.25rem',
    marginBottom: '1.5rem',
    textAlign: 'center',
  },
  bookInfo: {
    backgroundColor: '#f8f9fa',
    padding: '1rem',
    borderRadius: '4px',
    marginBottom: '1rem',
  },
  actions: {
    display: 'flex',
    gap: '1rem',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  button: {
    padding: '0.75rem 1.5rem',
    backgroundColor: '#3498db',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: 'bold',
  },
  buttonSecondary: {
    padding: '0.75rem 1.5rem',
    backgroundColor: '#95a5a6',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '1rem',
  },
  error: {
    color: '#e74c3c',
    padding: '1rem',
    backgroundColor: '#fadbd8',
    borderRadius: '4px',
    marginBottom: '1rem',
  },
  link: {
    color: '#3498db',
    textDecoration: 'none',
    fontSize: '1.1rem',
  },
};

export default Purchase;
