import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Navigation: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, isAuthenticated } = useAuth();

  const isActive = (path: string) => location.pathname === path;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <nav style={styles.nav}>
      <div style={styles.brand}>
        <h2>📚 Agentic Bookstore</h2>
      </div>
      <div style={styles.links}>
        <div style={styles.section}>
          <span style={styles.sectionTitle}>Store</span>
          <Link to="/catalog" style={isActive('/catalog') ? styles.activeLink : styles.link}>
            Catalog
          </Link>
          <Link to="/orders" style={isActive('/orders') ? styles.activeLink : styles.link}>
            My Orders
          </Link>
          {user?.role === 'STORE_ADMIN' && (
            <Link to="/warehouses" style={isActive('/warehouses') ? styles.activeLink : styles.link}>
              Warehouses
            </Link>
          )}
        </div>
        {(user?.role === 'WAREHOUSE_STAFF' || user?.role === 'STORE_ADMIN') && (
          <div style={styles.section}>
            <span style={styles.sectionTitle}>Warehouse</span>
            <Link
              to="/warehouse/inventory"
              style={isActive('/warehouse/inventory') ? styles.activeLink : styles.link}
            >
              Inventory
            </Link>
            <Link
              to="/warehouse/info"
              style={isActive('/warehouse/info') ? styles.activeLink : styles.link}
            >
              Info
            </Link>
          </div>
        )}
      </div>
      <div style={styles.userSection}>
        {isAuthenticated && user ? (
          <>
            <span style={styles.userEmail}>{user.email}</span>
            <button onClick={handleLogout} style={styles.logoutButton}>
              Logout
            </button>
          </>
        ) : (
          <Link to="/login" style={styles.loginButton}>
            Login
          </Link>
        )}
      </div>
    </nav>
  );
};

const styles: Record<string, React.CSSProperties> = {
  nav: {
    backgroundColor: '#2c3e50',
    padding: '1rem 2rem',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    color: 'white',
  },
  brand: {
    margin: 0,
  },
  links: {
    display: 'flex',
    gap: '2rem',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  sectionTitle: {
    fontSize: '0.75rem',
    textTransform: 'uppercase',
    opacity: 0.7,
    fontWeight: 'bold',
  },
  link: {
    color: 'white',
    textDecoration: 'none',
    padding: '0.5rem 1rem',
    borderRadius: '4px',
    transition: 'background-color 0.2s',
  },
  activeLink: {
    color: 'white',
    textDecoration: 'none',
    padding: '0.5rem 1rem',
    borderRadius: '4px',
    backgroundColor: '#34495e',
  },
  userSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
  },
  userEmail: {
    fontSize: '0.9rem',
    color: '#ecf0f1',
  },
  logoutButton: {
    padding: '0.5rem 1rem',
    backgroundColor: '#e74c3c',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '0.9rem',
    transition: 'background-color 0.2s',
  },
  loginButton: {
    padding: '0.5rem 1rem',
    backgroundColor: '#3498db',
    color: 'white',
    textDecoration: 'none',
    borderRadius: '4px',
    fontSize: '0.9rem',
    transition: 'background-color 0.2s',
  },
};

export default Navigation;
