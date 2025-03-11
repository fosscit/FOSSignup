import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
// Bootstrap CSS import
import "bootstrap/dist/css/bootstrap.min.css";
// Optional Bootstrap Icons (you'll need to install this package)
// import "bootstrap-icons/font/bootstrap-icons.css";

export default function AdminDashboard() {
  const [registrations, setRegistrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [driveFolderId, setDriveFolderId] = useState("");
  const [eventName, setEventName] = useState("");
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [formFields, setFormFields] = useState([]);
  const [showFieldModal, setShowFieldModal] = useState(false);
  const [newField, setNewField] = useState({ label: "", key: "", type: "text" });
  const [editIndex, setEditIndex] = useState(null);
  const navigate = useNavigate();
  
  useEffect(() => {
    // Check if admin is logged in
    const isAdmin = localStorage.getItem("adminLoggedIn") === "true";
    if (!isAdmin) {
      navigate("/");
      return;
    }
    
    // Fetch registrations data and form fields
    const fetchData = async () => {
      try {
        const [registrationsRes, formFieldsRes] = await Promise.all([
          axios.get("http://localhost:5000/registrations"),
          axios.get("http://localhost:5000/form-fields")
        ]);
        
        setRegistrations(registrationsRes.data);
        setFormFields(formFieldsRes.data);
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();

    const fetchDriveFolderId = async () => {
      try {
        const response = await axios.get("http://localhost:5000/drive-folder-id");
        setDriveFolderId(response.data.folderId);
      } catch (error) {
        console.error("Error fetching drive folder ID:", error);
      }
    };
    
    fetchDriveFolderId();
    
    const fetchEventName = async () => {
      try {
        const response = await axios.get("http://localhost:5000/event-name");
        setEventName(response.data.eventName || "");
      } catch (error) {
        console.error("Error fetching event name:", error);
      }
    };
    
    fetchEventName();
  }, [navigate]);

  const handleSaveDriveFolderId = async () => {
    try {
      await axios.post("http://localhost:5000/update-drive-folder-id", { folderId: driveFolderId });
      alert("Drive folder ID updated successfully");
      setShowFolderModal(false);
    } catch (error) {
      console.error("Error updating drive folder ID:", error);
      alert("Failed to update drive folder ID");
    }
  };
  
  const handleSaveEventName = async () => {
    try {
      await axios.post("http://localhost:5000/update-event-name", { eventName });
      alert("Event name updated successfully");
    } catch (error) {
      console.error("Error updating event name:", error);
      alert("Failed to update event name");
    }
  };
  
  const handleLogout = () => {
    localStorage.removeItem("adminLoggedIn");
    localStorage.removeItem("adminName");
    navigate("/");
  };
  
  const handleAddField = () => {
    setEditIndex(null);
    setNewField({ label: "", key: "", type: "text" });
    setShowFieldModal(true);
  };
  
  const handleEditField = (index) => {
    setEditIndex(index);
    setNewField({ ...formFields[index] });
    setShowFieldModal(true);
  };
  
  const handleRemoveField = async (index) => {
    if (!window.confirm("Are you sure you want to remove this field?")) return;
    
    const updatedFields = [...formFields];
    updatedFields.splice(index, 1);
    
    try {
      await axios.post("http://localhost:5000/update-form-fields", updatedFields);
      setFormFields(updatedFields);
      alert("Form field removed successfully");
    } catch (error) {
      console.error("Error removing field:", error);
      alert("Failed to remove field");
    }
  };
  
  const handleSaveField = async () => {
    // Validate input
    if (!newField.label || !newField.key) {
      alert("Please fill all required fields");
      return;
    }
    
    // Format key to be lowercase with no spaces
    const formattedKey = newField.key.toLowerCase().replace(/\s+/g, '_');
    const updatedField = { ...newField, key: formattedKey };
    
    try {
      let updatedFields;
      
      if (editIndex !== null) {
        // Update existing field
        updatedFields = [...formFields];
        updatedFields[editIndex] = updatedField;
      } else {
        // Add new field
        updatedFields = [...formFields, updatedField];
      }
      
      await axios.post("http://localhost:5000/update-form-fields", updatedFields);
      setFormFields(updatedFields);
      setShowFieldModal(false);
      alert(`Form field ${editIndex !== null ? 'updated' : 'added'} successfully`);
    } catch (error) {
      console.error("Error saving field:", error);
      alert("Failed to save field");
    }
  };
  
  const handleReorderFields = async (index, direction) => {
    if (
      (direction === 'up' && index === 0) || 
      (direction === 'down' && index === formFields.length - 1)
    ) return;
    
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    const updatedFields = [...formFields];
    
    // Swap positions
    [updatedFields[index], updatedFields[newIndex]] = [updatedFields[newIndex], updatedFields[index]];
    
    try {
      await axios.post("http://localhost:5000/update-form-fields", updatedFields);
      setFormFields(updatedFields);
    } catch (error) {
      console.error("Error reordering fields:", error);
      alert("Failed to reorder fields");
    }
  };
  
  const handleFieldInputChange = (e) => {
    const { name, value } = e.target;
    setNewField(prev => ({
      ...prev,
      [name]: value
    }));
  };
  
  return (
    <div className="d-flex flex-column min-vh-100 bg-light">
      {/* Header */}
      <header className="bg-dark text-white shadow-sm sticky-top">
        <div className="container-fluid py-3">
          <div className="row align-items-center">
            <div className="col-md-6 d-flex align-items-center">
              <div className="bg-info text-dark fw-bold p-2 rounded me-3">FOSS</div>
              <h1 className="h4 mb-0">Event Registration Dashboard</h1>
            </div>
            <div className="col-md-6 d-flex justify-content-end align-items-center mt-3 mt-md-0">
              <span className="me-3">Welcome, {localStorage.getItem("adminName") || "Admin"}</span>
              <button
                onClick={handleLogout}
                className="btn btn-danger"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </header>
      
      {/* Main Content */}
      <main className="flex-grow-1 py-4">
        <div className="container-fluid">
          <div className="row g-4">
            {/* Sidebar */}
            <div className="col-lg-3 col-md-4 mb-4 mb-md-0">
              <div className="bg-dark text-white rounded p-3 h-100 sticky-top" style={{top: "80px"}}>
                <div className="border-bottom border-secondary pb-3 mb-3">
                  <h3 className="h5">Admin Menu</h3>
                </div>
                <nav className="mb-auto">
                  <ul className="nav flex-column">
                    <li className="nav-item">
                      <a href="#event-settings" className="nav-link text-white active">Event Settings</a>
                    </li>
                    <li className="nav-item">
                      <a href="#form-fields" className="nav-link text-white">Form Fields</a>
                    </li>
                    <li className="nav-item">
                      <a href="#drive-settings" className="nav-link text-white">Google Drive Settings</a>
                    </li>
                    <li className="nav-item">
                      <a href="#registrations" className="nav-link text-white">Registration Entries</a>
                    </li>
                  </ul>
                </nav>
                <div className="border-top border-secondary pt-3 mt-3 small text-muted">
                  <p className="mb-1">FOSS Club Dashboard</p>
                  <p className="text-info mb-0">v1.0.0</p>
                </div>
              </div>
            </div>
            
            {/* Content Area */}
            <div className="col-lg-9 col-md-8">
              <div className="d-flex flex-column gap-4">
                {/* Event Settings */}
                <section id="event-settings" className="card shadow-sm">
                  <div className="card-header bg-white py-3">
                    <h2 className="h5 mb-0">Event Settings</h2>
                  </div>
                  <div className="card-body p-4">
                    <div className="row mb-4">
                      <div className="col-md-3">
                        <label htmlFor="eventName" className="form-label fw-bold mb-0 pt-2">Current Event Name:</label>
                      </div>
                      <div className="col-md-9">
                        <div className="input-group">
                          <input
                            type="text"
                            id="eventName"
                            className="form-control"
                            value={eventName}
                            onChange={(e) => setEventName(e.target.value)}
                            placeholder="Enter event name"
                          />
                          <button
                            onClick={handleSaveEventName}
                            className="btn btn-info text-white"
                          >
                            Save
                          </button>
                        </div>
                        <p className="text-muted small mt-2">This name will be displayed on the registration form and all related communications.</p>
                      </div>
                    </div>
                  </div>
                </section>
                
                {/* Form Fields Management */}
                <section id="form-fields" className="card shadow-sm">
                  <div className="card-header d-flex justify-content-between align-items-center bg-white py-3">
                    <h2 className="h5 mb-0">Registration Form Fields</h2>
                    <button
                      onClick={handleAddField}
                      className="btn btn-info text-white"
                    >
                      <span className="me-1">+</span> Add New Field
                    </button>
                  </div>
                  
                  <div className="card-body p-4">
                    {formFields.length === 0 ? (
                      <div className="text-center py-5 text-muted">
                        <div className="display-4 mb-3">📝</div>
                        <p>No form fields configured. Add fields to create your registration form.</p>
                      </div>
                    ) : (
                      <div className="table-responsive">
                        <table className="table table-hover">
                          <thead>
                            <tr>
                              <th>Order</th>
                              <th>Label</th>
                              <th>Field Key</th>
                              <th>Input Type</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {formFields.map((field, index) => (
                              <tr key={index}>
                                <td>
                                  <div className="d-flex align-items-center">
                                    <button
                                      onClick={() => handleReorderFields(index, 'up')}
                                      disabled={index === 0}
                                      className="btn btn-sm btn-light"
                                    >
                                      ↑
                                    </button>
                                    <button
                                      onClick={() => handleReorderFields(index, 'down')}
                                      disabled={index === formFields.length - 1}
                                      className="btn btn-sm btn-light mx-1"
                                    >
                                      ↓
                                    </button>
                                    <span>{index + 1}</span>
                                  </div>
                                </td>
                                <td>{field.label}</td>
                                <td><code>{field.key}</code></td>
                                <td>{field.type}</td>
                                <td>
                                  <div className="d-flex gap-2">
                                    <button
                                      onClick={() => handleEditField(index)}
                                      className="btn btn-sm btn-outline-primary"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={() => handleRemoveField(index)}
                                      className="btn btn-sm btn-outline-danger"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </section>

                {/* Google Drive Settings */}
                <section id="drive-settings" className="card shadow-sm">
                  <div className="card-header d-flex justify-content-between align-items-center bg-white py-3">
                    <h2 className="h5 mb-0">Google Drive Integration</h2>
                    <button
                      onClick={() => setShowFolderModal(true)}
                      className="btn btn-info text-white"
                    >
                      Update Folder ID
                    </button>
                  </div>
                  <div className="card-body p-4">
                    <div>
                      <h3 className="h6 text-muted mb-2">Current Folder ID</h3>
                      <div className="p-3 bg-dark text-white rounded font-monospace text-break">
                        {driveFolderId || "Not set"}
                      </div>
                      <p className="text-muted small mt-2">This folder will be used to store registration documents and attachments.</p>
                    </div>
                  </div>
                </section>
                
                {/* Registration Entries */}
                <section id="registrations" className="card shadow-sm">
                  <div className="card-header d-flex justify-content-between align-items-center bg-white py-3">
                    <h2 className="h5 mb-0">Registration Entries</h2>
                    <div>
                      <button className="btn btn-info text-white">
                        Export CSV
                      </button>
                    </div>
                  </div>
                  
                  <div className="card-body p-4">
                    {loading ? (
                      <div className="text-center py-5 text-muted">
                        <div className="spinner-border text-info mb-3" role="status">
                          <span className="visually-hidden">Loading...</span>
                        </div>
                        <p>Loading registration data...</p>
                      </div>
                    ) : registrations.length === 0 ? (
                      <div className="text-center py-5 text-muted">
                        <div className="display-4 mb-3">📊</div>
                        <p>No registrations found.</p>
                      </div>
                    ) : (
                      <div className="table-responsive">
                        <table className="table table-hover">
                          <thead>
                            <tr>
                              {Object.keys(registrations[0]).map((key) => (
                                <th key={key}>{key}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {registrations.map((registration, index) => (
                              <tr key={index}>
                                {Object.values(registration).map((value, i) => (
                                  <td key={i} className="text-truncate" style={{maxWidth: "200px"}}>{value || 'N/A'}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="bg-dark text-white py-3 mt-auto">
        <div className="container-fluid text-center">
          <p className="mb-1">Free and Open Source Software Club &copy; {new Date().getFullYear()}</p>
          <div className="small">
            <a href="#" className="text-info me-3" target="_blank" rel="noopener noreferrer">GitHub</a>
            <a href="#" className="text-info me-3" target="_blank" rel="noopener noreferrer">Documentation</a>
            <a href="#" className="text-info" target="_blank" rel="noopener noreferrer">Report Issues</a>
          </div>
        </div>
      </footer>

      {/* Folder ID Modal */}
      {showFolderModal && (
        <div className="modal show d-block" tabIndex="-1">
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Update Google Drive Folder ID</h5>
                <button type="button" className="btn-close" onClick={() => setShowFolderModal(false)}></button>
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label">Folder ID</label>
                  <input
                    type="text"
                    value={driveFolderId}
                    onChange={(e) => setDriveFolderId(e.target.value)}
                    placeholder="Enter Google Drive Folder ID"
                    className="form-control"
                  />
                  <div className="form-text">Find this ID in the URL of your Google Drive folder.</div>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowFolderModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-info text-white"
                  onClick={handleSaveDriveFolderId}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
          <div className="modal-backdrop show" onClick={() => setShowFolderModal(false)}></div>
        </div>
      )}
      
      {/* Field Modal */}
      {showFieldModal && (
        <div className="modal show d-block" tabIndex="-1">
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{editIndex !== null ? "Edit Field" : "Add New Field"}</h5>
                <button type="button" className="btn-close" onClick={() => setShowFieldModal(false)}></button>
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label">Field Label</label>
                  <input
                    type="text"
                    name="label"
                    value={newField.label}
                    onChange={handleFieldInputChange}
                    placeholder="Enter your Name"
                    className="form-control"
                    required
                  />
                  <div className="form-text">This is what the user will see as the form label.</div>
                </div>
                <div className="mb-3">
                  <label className="form-label">Field Key</label>
                  <input
                    type="text"
                    name="key"
                    value={newField.key}
                    onChange={handleFieldInputChange}
                    placeholder="name"
                    className="form-control"
                    required
                  />
                  <div className="form-text">Used as column name in CSV. Use lowercase letters, no spaces.</div>
                </div>
                <div className="mb-3">
                  <label className="form-label">Input Type</label>
                  <select
                    name="type"
                    value={newField.type}
                    onChange={handleFieldInputChange}
                    className="form-select"
                  >
                    <option value="text">Text</option>
                    <option value="email">Email</option>
                    <option value="tel">Phone</option>
                    <option value="number">Number</option>
                    <option value="date">Date</option>
                    <option value="url">URL</option>
                  </select>
                  <div className="form-text">Type of input field to display on the form.</div>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowFieldModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-info text-white"
                  onClick={handleSaveField}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
          <div className="modal-backdrop show" onClick={() => setShowFieldModal(false)}></div>
        </div>
      )}
    </div>
  );
}