import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BookCard from '../components/BookCard';
import { storeService } from '../services/api';
import type { Book } from '../services/types';

const Catalog: React.FC = () => {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    loadBooks();
  }, []);

  const loadBooks = async () => {
    try {
      setLoading(true);
      const data = await storeService.getBooks();
      setBooks(data);
      setError(null);
    } catch (err) {
      setError('Failed to load books. Please try again later.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handlePurchase = async (bookId: string) => {
    try {
      const book = books.find((b) => b.id === bookId);
      if (!book) return;

      await storeService.createOrder(bookId, 1);
      navigate('/purchase', { state: { book } });
    } catch (err) {
      alert('Failed to create order. Please try again.');
      console.error(err);
    }
  };

  if (loading) {
    return <div style={styles.container}>Loading catalog...</div>;
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.error}>{error}</div>
        <button onClick={loadBooks} style={styles.retryButton}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Book Catalog</h1>
      <div style={styles.grid}>
        {books.map((book) => (
          <BookCard key={book.id} book={book} onPurchase={handlePurchase} />
        ))}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '2rem',
    maxWidth: '1200px',
    margin: '0 auto',
  },
  title: {
    marginBottom: '2rem',
    color: '#2c3e50',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: '1.5rem',
  },
  error: {
    color: '#e74c3c',
    padding: '1rem',
    backgroundColor: '#fadbd8',
    borderRadius: '4px',
    marginBottom: '1rem',
  },
  retryButton: {
    padding: '0.75rem 1.5rem',
    backgroundColor: '#3498db',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '1rem',
  },
};

export default Catalog;
