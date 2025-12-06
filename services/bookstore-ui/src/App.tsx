import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { setAuthCredentials } from './services/api';
import Navigation from './components/Navigation';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import Catalog from './pages/Catalog';
import Purchase from './pages/Purchase';
import Orders from './pages/Orders';
import Warehouses from './pages/Warehouses';
import WarehouseInventory from './pages/WarehouseInventory';
import WarehouseInfo from './pages/WarehouseInfo';
import './App.css';

// Component to sync auth state with API service
const AuthSync: React.FC = () => {
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      setAuthCredentials(user.email, user.password);
    } else {
      setAuthCredentials(null, null);
    }
  }, [user]);

  return null;
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <Router>
        <AuthSync />
        <div className="app">
          <Navigation />
          <main className="main-content">
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/" element={<Navigate to="/catalog" replace />} />
              <Route path="/catalog" element={<Catalog />} />
              <Route
                path="/purchase"
                element={
                  <ProtectedRoute>
                    <Purchase />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/orders"
                element={
                  <ProtectedRoute>
                    <Orders />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/warehouses"
                element={
                  <ProtectedRoute>
                    <Warehouses />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/warehouse/inventory"
                element={
                  <ProtectedRoute>
                    <WarehouseInventory />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/warehouse/info"
                element={
                  <ProtectedRoute>
                    <WarehouseInfo />
                  </ProtectedRoute>
                }
              />
            </Routes>
          </main>
        </div>
      </Router>
    </AuthProvider>
  );
};

export default App;
