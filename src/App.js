import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import MultiStepForm from "./components/MultiStepForm.js";
import AdminDashboard from "./components/AdminDashboard.js";


// Protected route component
const ProtectedRoute = ({ children }) => {
  const isAdmin = localStorage.getItem("adminLoggedIn") === "true";
  if (!isAdmin) {
    return <Navigate to="/" />;
  }
  return children;
};

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<MultiStepForm />} />
        <Route 
          path="/admin-dashboard" 
          element={
            <ProtectedRoute>
              <AdminDashboard />
            </ProtectedRoute>
          } 
        />
      </Routes>
    </Router>
  );
}

export default App;
