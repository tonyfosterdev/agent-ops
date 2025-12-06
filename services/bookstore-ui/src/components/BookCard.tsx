import React from 'react';
import type { Book } from '../services/types';

interface BookCardProps {
  book: Book;
  onPurchase?: (bookId: string) => void;
}

const BookCard: React.FC<BookCardProps> = ({ book, onPurchase }) => {
  const isAvailable = book.availableStock > 0;

  return (
    <div style={styles.card}>
      <div style={styles.content}>
        <h3 style={styles.title}>{book.title}</h3>
        <p style={styles.author}>by {book.author}</p>
        <div style={styles.details}>
          <span style={styles.genre}>{book.genre}</span>
          <span style={styles.year}>{book.publishedYear}</span>
        </div>
        <p style={styles.isbn}>ISBN: {book.isbn}</p>
        <div style={styles.footer}>
          <span style={styles.price}>${book.price.toFixed(2)}</span>
          <span style={isAvailable ? styles.inStock : styles.outOfStock}>
            {isAvailable ? `${book.availableStock} in stock` : 'Out of stock'}
          </span>
        </div>
      </div>
      {onPurchase && (
        <button
          onClick={() => onPurchase(book.id)}
          disabled={!isAvailable}
          style={isAvailable ? styles.button : styles.buttonDisabled}
        >
          Purchase
        </button>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  card: {
    border: '1px solid #ddd',
    borderRadius: '8px',
    padding: '1rem',
    backgroundColor: 'white',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
  },
  content: {
    marginBottom: '1rem',
  },
  title: {
    margin: '0 0 0.5rem 0',
    fontSize: '1.25rem',
    color: '#2c3e50',
  },
  author: {
    margin: '0 0 0.5rem 0',
    color: '#7f8c8d',
    fontStyle: 'italic',
  },
  details: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '0.5rem',
  },
  genre: {
    fontSize: '0.875rem',
    padding: '0.25rem 0.5rem',
    backgroundColor: '#ecf0f1',
    borderRadius: '4px',
  },
  year: {
    fontSize: '0.875rem',
    color: '#95a5a6',
  },
  isbn: {
    fontSize: '0.75rem',
    color: '#95a5a6',
    margin: '0.5rem 0',
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: '1rem',
  },
  price: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: '#27ae60',
  },
  inStock: {
    color: '#27ae60',
    fontSize: '0.875rem',
  },
  outOfStock: {
    color: '#e74c3c',
    fontSize: '0.875rem',
  },
  button: {
    width: '100%',
    padding: '0.75rem',
    backgroundColor: '#3498db',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: 'bold',
  },
  buttonDisabled: {
    width: '100%',
    padding: '0.75rem',
    backgroundColor: '#bdc3c7',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'not-allowed',
    fontSize: '1rem',
  },
};

export default BookCard;
