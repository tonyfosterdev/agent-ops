import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as any)?.from?.pathname || '/catalog';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (email && password) {
      login(email, password);
      navigate(from, { replace: true });
    }
  };

  const quickLogin = (email: string, password: string) => {
    setEmail(email);
    setPassword(password);
    login(email, password);
    navigate(from, { replace: true });
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Bookstore Login</h1>
        <p style={styles.subtitle}>Sign in to browse and purchase books</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              style={styles.input}
              required
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              style={styles.input}
              required
            />
          </div>

          <button type="submit" style={styles.submitButton}>
            Sign In
          </button>
        </form>

        <div style={styles.divider}>
          <span style={styles.dividerText}>Quick Login (Demo Accounts)</span>
        </div>

        <div style={styles.quickLoginButtons}>
          <button
            onClick={() => quickLogin('alice@customer.com', 'alice123')}
            style={styles.quickButton}
          >
            Customer (Alice)
          </button>
          <button
            onClick={() => quickLogin('bob@customer.com', 'bob123')}
            style={styles.quickButton}
          >
            Customer (Bob)
          </button>
          <button
            onClick={() => quickLogin('admin@bookstore.com', 'admin123')}
            style={styles.quickButtonAdmin}
          >
            Store Admin
          </button>
          <button
            onClick={() => quickLogin('staff@warehouse-alpha.com', 'staff123')}
            style={styles.quickButtonWarehouse}
          >
            Warehouse Alpha Staff
          </button>
          <button
            onClick={() => quickLogin('staff@warehouse-beta.com', 'staff123')}
            style={styles.quickButtonWarehouse}
          >
            Warehouse Beta Staff
          </button>
        </div>

        <div style={styles.credentials}>
          <p style={styles.credentialsTitle}>Test Credentials:</p>
          <ul style={styles.credentialsList}>
            <li>Customer: alice@customer.com / alice123</li>
            <li>Customer: bob@customer.com / bob123</li>
            <li>Admin: admin@bookstore.com / admin123</li>
            <li>Warehouse Alpha: staff@warehouse-alpha.com / staff123</li>
            <li>Warehouse Beta: staff@warehouse-beta.com / staff123</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    backgroundColor: '#f5f5f5',
    padding: '2rem',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '8px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
    padding: '3rem',
    maxWidth: '500px',
    width: '100%',
  },
  title: {
    margin: '0 0 0.5rem 0',
    color: '#2c3e50',
    fontSize: '2rem',
    textAlign: 'center',
  },
  subtitle: {
    margin: '0 0 2rem 0',
    color: '#7f8c8d',
    textAlign: 'center',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  label: {
    fontSize: '0.9rem',
    fontWeight: 600,
    color: '#2c3e50',
  },
  input: {
    padding: '0.75rem',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '1rem',
    transition: 'border-color 0.3s',
  },
  submitButton: {
    padding: '0.75rem',
    backgroundColor: '#3498db',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '1rem',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background-color 0.3s',
  },
  divider: {
    margin: '2rem 0',
    textAlign: 'center',
    position: 'relative',
  },
  dividerText: {
    backgroundColor: 'white',
    padding: '0 1rem',
    color: '#7f8c8d',
    fontSize: '0.9rem',
    position: 'relative',
    zIndex: 1,
  },
  quickLoginButtons: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  quickButton: {
    padding: '0.75rem',
    backgroundColor: '#95a5a6',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '0.9rem',
    cursor: 'pointer',
    transition: 'background-color 0.3s',
  },
  quickButtonAdmin: {
    padding: '0.75rem',
    backgroundColor: '#e74c3c',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '0.9rem',
    cursor: 'pointer',
    transition: 'background-color 0.3s',
  },
  quickButtonWarehouse: {
    padding: '0.75rem',
    backgroundColor: '#9b59b6',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '0.9rem',
    cursor: 'pointer',
    transition: 'background-color 0.3s',
  },
  credentials: {
    marginTop: '2rem',
    padding: '1rem',
    backgroundColor: '#ecf0f1',
    borderRadius: '4px',
  },
  credentialsTitle: {
    margin: '0 0 0.5rem 0',
    fontWeight: 600,
    color: '#2c3e50',
    fontSize: '0.9rem',
  },
  credentialsList: {
    margin: 0,
    paddingLeft: '1.5rem',
    color: '#7f8c8d',
    fontSize: '0.85rem',
  },
};

export default Login;
