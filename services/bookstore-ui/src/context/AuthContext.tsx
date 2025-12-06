import React, { createContext, useContext, useState, useEffect } from 'react';

export interface AuthUser {
  email: string;
  password: string;
  role: 'CUSTOMER' | 'STORE_ADMIN' | 'WAREHOUSE_STAFF';
}

// Determine role from email (for demo purposes)
function getRoleFromEmail(email: string): 'CUSTOMER' | 'STORE_ADMIN' | 'WAREHOUSE_STAFF' {
  if (email.includes('admin@bookstore.com')) {
    return 'STORE_ADMIN';
  }
  if (email.includes('staff@warehouse-')) {
    return 'WAREHOUSE_STAFF';
  }
  return 'CUSTOMER';
}

interface AuthContextType {
  user: AuthUser | null;
  login: (email: string, password: string) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);

  // Load user from localStorage on mount
  useEffect(() => {
    const savedUser = localStorage.getItem('auth_user');
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        // Migration: Add role if missing (for old sessions)
        if (!parsed.role && parsed.email) {
          parsed.role = getRoleFromEmail(parsed.email);
          localStorage.setItem('auth_user', JSON.stringify(parsed));
        }
        setUser(parsed);
      } catch (e) {
        localStorage.removeItem('auth_user');
      }
    }
  }, []);

  const login = (email: string, password: string) => {
    const userData: AuthUser = {
      email,
      password,
      role: getRoleFromEmail(email)
    };
    setUser(userData);
    localStorage.setItem('auth_user', JSON.stringify(userData));
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('auth_user');
  };

  const value = {
    user,
    login,
    logout,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
