
require('dotenv').config();
const express = require("express");
const fs = require("fs");
const { google } = require("googleapis");
const cors = require("cors");
const csv = require('csv-parser');
const path = require('path');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const { Readable } = require('stream');

const app = express();
app.use(express.json());
app.use(cors({
  origin: 'https://fossignup.netlify.app/',
  credentials: true // If you need to support cookies/authentication
}));

// Path to the form fields configuration file
const formFieldsPath = path.join(__dirname, "formFields.json");
const driveFolderPath = path.join(__dirname, "driveFolder.json");

// Path to the config file where settings will be stored
const CONFIG_FILE_PATH = path.join(__dirname, 'config.json');




// Initialize drive folder ID with default value if the file doesn't exist
if (!fs.existsSync(driveFolderPath)) {
  fs.writeFileSync(driveFolderPath, JSON.stringify({ folderId: "" }));
}

// Initialize form fields with default values if the file doesn't exist
if (!fs.existsSync(formFieldsPath)) {
  fs.writeFileSync(
    formFieldsPath,
    JSON.stringify([
      { label: "Name", key: "name", type: "text" },
      { label: "Email", key: "email", type: "email" },
      { label: "Phone", key: "phone", type: "tel" },
    ])
  );
}

// Get form fields
const getFormFields = () => {
  try {
    return JSON.parse(fs.readFileSync(formFieldsPath));
  } catch (error) {
    console.error("Error reading form fields:", error);
    return [
      { label: "Name", key: "name", type: "text" },
      { label: "Email", key: "email", type: "email" },
      { label: "Phone", key: "phone", type: "tel" },
    ];
  }
};

const getDriveService = async () => {
  try {
    // Create credentials object from environment variables
    const credentials = {
      type: process.env.TYPE,
      project_id: process.env.PROJECT_ID,
      private_key_id: process.env.PRIVATE_KEY_ID,
      private_key: process.env.PRIVATE_KEY,
      client_email: process.env.CLIENT_EMAIL,
      client_id: process.env.CLIENT_ID,
      auth_uri: process.env.AUTH_URI,
      token_uri: process.env.TOKEN_URI,
      auth_provider_x509_cert_url: process.env.AUTH_PROVIDER_X509_CERT_URL,
      client_x509_cert_url: process.env.CLIENT_X509_CERT_URL,
      universe_domain: process.env.UNIVERSE_DOMAIN
    };

    // Use JWT auth with credentials from environment variables
    const auth = new google.auth.GoogleAuth({
      credentials: credentials,
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });

    return google.drive({ version: "v3", auth });
  } catch (error) {
    console.error("Error creating Drive service:", error);
    throw error;
  }
};



// Function to read config from file
function readConfigFile() {
  return new Promise((resolve, reject) => {
    fs.readFile(CONFIG_FILE_PATH, 'utf8', (err, data) => {
      if (err) {
        // If file doesn't exist, return empty object
        if (err.code === 'ENOENT') {
          return resolve({});
        }
        return reject(err);
      }
      try {
        resolve(JSON.parse(data));
      } catch (parseErr) {
        reject(parseErr);
      }
    });
  });
}

// Function to write config to file
function writeConfigFile(data) {
  return new Promise((resolve, reject) => {
    fs.writeFile(CONFIG_FILE_PATH, JSON.stringify(data, null, 2), 'utf8', (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

// Function to read event name from storage
async function readEventNameFromStorage() {
  const config = await readConfigFile();
  return config.eventName || '';
}

// Function to save event name to storage
async function saveEventNameToStorage(eventName) {
  const config = await readConfigFile();
  config.eventName = eventName;
  await writeConfigFile(config);
}

// Get current Drive file ID or create a new one
const getDriveFileId = async (driveService) => {
  const fileName = "event_registration.csv";
  
  try {
    // Read the folder ID from the file
    const folderId = JSON.parse(fs.readFileSync(driveFolderPath)).folderId;
    if (!folderId) {
      throw new Error("Drive folder ID is not set");
    }

    // Check if the file already exists
    const response = await driveService.files.list({
      q: `name='${fileName}' and '${folderId}' in parents and trashed=false`,
      fields: "files(id, name)",
    });

    const fileExists = response.data.files.length > 0;
    
    if (fileExists) {
      return response.data.files[0].id;
    } else {
      // Create a new empty file with headers
      const formFields = getFormFields();
      const headerRow = formFields.map(field => field.label).join(',') + ',Date\n';
      
      const fileMetadata = {
        name: fileName,
        parents: [folderId],
      };

      const media = {
        mimeType: "text/csv",
        body: Readable.from([headerRow]),
      };

      const file = await driveService.files.create({
        resource: fileMetadata,
        media: media,
        fields: "id",
      });

      console.log("New file created in Google Drive!");
      return file.data.id;
    }
  } catch (error) {
    console.error("Error getting Drive file ID:", error);
    throw error;
  }
};

// Function to read data directly from Google Drive
// Function to read data directly from Google Drive
const readRegistrationsFromDrive = async () => {
  try {
    const driveService = await getDriveService();
    const fileId = await getDriveFileId(driveService);
    
    // Download the file
    const response = await driveService.files.get({
      fileId: fileId,
      alt: 'media'
    }, { responseType: 'stream' });
    
    return new Promise((resolve, reject) => {
      const registrations = [];
      response.data
        .pipe(csv({
          // Add options to handle quoted values better
          strict: true,
          mapValues: ({ header, value }) => {
            // Special handling for phone data
            if (header.toLowerCase() === 'phone') {
              return value.trim();
            }
            return value;
          }
        }))
        .on('data', (data) => {
          // Log phone data for debugging
          if (data.phone || data.Phone) {
            console.log('Read phone data:', data.phone || data.Phone);
          }
          registrations.push(data);
        })
        .on('end', () => resolve(registrations))
        .on('error', (error) => reject(error));
    });
  } catch (error) {
    console.error("Error reading registrations from Drive:", error);
    return [];
  }
};

// Function to add a new registration directly to Drive
// Function to add a new registration directly to Drive
const addRegistrationToDrive = async (formData) => {
  try {
    // Get form fields and prepare record
    const formFields = getFormFields();
    const timestamp = new Date().toISOString();
    
    // Create a new record object with all fields
    const record = {};
    formFields.forEach(field => {
      // Handle phone numbers specifically - strip non-digit characters if needed
      if (field.type === 'tel' && formData[field.key]) {
        // Store original format but ensure it's properly cleaned for CSV
        record[field.key] = formData[field.key].toString().trim();
      } else {
        // Make sure to map the incoming form data to all form fields, even newly added ones
        record[field.key] = formData[field.key] !== undefined ? formData[field.key] : '';
      }
    });
    record.date = timestamp;
    
    // Get Drive service and file ID
    const driveService = await getDriveService();
    const fileId = await getDriveFileId(driveService);
    
    // Get existing data
    const existingData = await readRegistrationsFromDrive();
    
    // Prepare headers based on current form fields
    const headers = formFields.map(field => field.label);
    headers.push('Date');
    
    // Prepare CSV content
    let csvContent = "";
    
    // If it's a new file or has no data, add headers
    if (existingData.length === 0) {
      csvContent += headers.join(',') + '\n';
    }
    
    // Add the new record
    const recordValues = formFields.map(field => {
      // Ensure proper escaping for all values
      const value = record[field.key] || '';
      
      // Always quote values to avoid CSV formatting issues
      return `"${value.toString().replace(/"/g, '""')}"`;
    });
    recordValues.push(`"${record.date}"`);
    
    csvContent += recordValues.join(',') + '\n';
    
    // If we have existing data, we need to append to existing CSV file
    if (existingData.length > 0) {
      // First, download the existing CSV
      const existingCSV = await driveService.files.get({
        fileId: fileId,
        alt: 'media'
      });
      
      // Append our new record to the existing content
      csvContent = existingCSV.data + csvContent;
    }
    
    // Log the record for debugging
    console.log('Adding record:', record);
    
    // Update the file on Drive
    await driveService.files.update({
      fileId: fileId,
      media: {
        mimeType: "text/csv",
        body: Readable.from([csvContent]),
      },
    });
    
    console.log('Registration added directly to Google Drive!');
    return true;
  } catch (error) {
    console.error("Error adding registration to Drive:", error);
    return false;
  }
};




// Replace your /admins endpoint with this
app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  
  // Get admin credentials from environment variables
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;


  console.log("Login attempt:", username);
  
  if (username === adminUsername && password === adminPassword) {
    // You might want to implement a proper JWT token here for better security
    res.json({ 
      success: true, 
      message: 'Login successful',
      username: adminUsername
    });
  } else {
    res.status(401).json({ 
      success: false, 
      message: 'Invalid credentials' 
    });
  }
});








// GET endpoint to retrieve the current event name
app.get("/event-name", async (req, res) => {
  try {
    // Read event name from your database or config file
    // This is a placeholder - replace with your actual data storage method
    const eventData = await readEventNameFromStorage();
    res.json({ eventName: eventData });
  } catch (error) {
    console.error("Error fetching event name:", error);
    res.status(500).json({ error: "Failed to fetch event name" });
  }
});

// POST endpoint to update the event name
app.post("/update-event-name", async (req, res) => {
  try {
    const { eventName } = req.body;
    
    // Validate input
    if (!eventName) {
      return res.status(400).json({ error: "Event name is required" });
    }
    
    // Save event name to your database or config file
    // This is a placeholder - replace with your actual data storage method
    await saveEventNameToStorage(eventName);
    
    res.json({ success: true, message: "Event name updated successfully" });
  } catch (error) {
    console.error("Error updating event name:", error);
    res.status(500).json({ error: "Failed to update event name" });
  }
});

// Endpoint to create a new registration file when changing Drive folder
app.post("/update-drive-folder-id", async (req, res) => {
  try {
    const { folderId } = req.body;
    
    // Get the current folder ID
    let currentFolderId = "";
    try {
      const folderData = JSON.parse(fs.readFileSync(driveFolderPath));
      currentFolderId = folderData.folderId;
    } catch (error) {
      console.log("No existing drive folder ID found");
    }
    
    // Check if this is a new folder ID
    const isNewFolder = folderId !== currentFolderId;
    
    // Write the new folder ID
    fs.writeFileSync(driveFolderPath, JSON.stringify({ folderId }));
    
    // If this is a new folder, create an empty CSV file with just headers
    if (isNewFolder) {
      const driveService = await getDriveService();
      
      // Create a new empty file with headers
      const formFields = getFormFields();
      const headerRow = formFields.map(field => field.label).join(',') + ',Date\n';
      
      const fileMetadata = {
        name: "event_registration.csv",
        parents: [folderId],
      };

      const media = {
        mimeType: "text/csv",
        body: Readable.from([headerRow]),
      };

      await driveService.files.create({
        resource: fileMetadata,
        media: media,
        fields: "id",
      });
      
      res.json({ message: "Drive folder ID updated successfully with new empty CSV file" });
    } else {
      res.json({ message: "Drive folder ID updated successfully" });
    }
  } catch (error) {
    console.error("Error updating drive folder ID:", error);
    res.status(500).json({ error: "Failed to update drive folder ID" });
  }
});

// Endpoint to get drive folder ID
app.get("/drive-folder-id", (req, res) => {
  try {
    const folderId = JSON.parse(fs.readFileSync(driveFolderPath));
    res.json(folderId);
  } catch (error) {
    console.error("Error reading drive folder ID:", error);
    res.status(500).json({ error: "Failed to read drive folder ID" });
  }
});

// Backend routes
app.get("/steps", (req, res) => {
  const steps = require("./steps.js"); // Import the steps configuration
  res.json(steps); // Send the steps as JSON
});

// Endpoint to get form fields
app.get("/form-fields", (req, res) => {
  try {
    const formFields = JSON.parse(fs.readFileSync(formFieldsPath));
    res.json(formFields);
  } catch (error) {
    console.error("Error reading form fields:", error);
    res.status(500).json({ error: "Failed to read form fields" });
  }
});

// Endpoint to update form fields
app.post("/update-form-fields", async (req, res) => {
  try {
    const newFields = req.body;
    fs.writeFileSync(formFieldsPath, JSON.stringify(newFields));
    
    // Reconstruct the CSV with new field structure
    try {
      // Get Drive service and file ID
      const driveService = await getDriveService();
      const fileId = await getDriveFileId(driveService);
      
      // Read existing data
      const existingData = await readRegistrationsFromDrive();
      
      // Create new headers
      const headerRow = newFields.map(field => field.label).join(',') + ',Date\n';
      
      // Map existing data to match new structure
      let csvContent = headerRow;
      
      if (existingData.length > 0) {
        existingData.forEach(entry => {
          const rowValues = newFields.map(field => {
            // Try to find the value in existing data
            const value = entry[field.key] || 
                         entry[field.label] || 
                         entry[field.label.toLowerCase()] || 
                         '';
            
            // Escape commas and quotes in values
            if (value.includes(',') || value.includes('"')) {
              return `"${value.replace(/"/g, '""')}"`;
            }
            return value;
          });
          
          // Add the date field
          rowValues.push(entry.Date || entry.date || '');
          
          csvContent += rowValues.join(',') + '\n';
        });
      }
      
      // Update the file on Drive
      await driveService.files.update({
        fileId: fileId,
        media: {
          mimeType: "text/csv",
          body: Readable.from([csvContent]),
        },
      });
      
      console.log('CSV structure updated on Google Drive!');
      res.json({ message: "Form fields updated successfully and CSV schema updated" });
    } catch (error) {
      console.error("Error updating CSV structure:", error);
      res.json({ message: "Form fields updated but CSV schema update failed" });
    }
  } catch (error) {
    console.error("Error updating form fields:", error);
    res.status(500).json({ error: "Failed to update form fields" });
  }
});

app.post("/upload", async (req, res) => {
  try {
    const formFields = getFormFields();
    const driveService = await getDriveService();
    const fileId = await getDriveFileId(driveService);
    
    const timestamp = new Date().toISOString();
    
    console.log("Incoming form data:", JSON.stringify(req.body));
    
    const record = {};
    formFields.forEach(field => {
      console.log(`Processing field ${field.key} (${field.label}), incoming value:`, req.body[field.key]);
      
      if (field.type === 'tel' && req.body[field.key]) {
        record[field.key] = req.body[field.key].toString().trim();
      } else {
        const value = req.body[field.key] !== undefined ? req.body[field.key] : 
                     (req.body[field.label] !== undefined ? req.body[field.label] : '');
        record[field.key] = value;
      }
      
      console.log(`Field ${field.key} processed value:`, record[field.key]);
    });
    record.date = timestamp;
    
    console.log("Final record to be written:", JSON.stringify(record));
    
    const existingData = await readRegistrationsFromDrive();
    
    const headers = formFields.map(field => field.label);
    headers.push('Date');
    
    let csvContent = headers.join(',') + '\n';
    
    existingData.forEach(entry => {
      const rowValues = formFields.map(field => {
        const value = entry[field.key] || 
                     entry[field.label] || 
                     entry[field.label.toLowerCase()] || 
                     '';
        return `"${value.toString().replace(/"/g, '""')}"`;
      });
      rowValues.push(`"${entry.Date || entry.date || ''}"`);
      csvContent += rowValues.join(',') + '\n';
    });
    
    const newRecordValues = formFields.map(field => {
      const value = record[field.key] || '';
      return `"${value.toString().replace(/"/g, '""')}"`;
    });
    newRecordValues.push(`"${record.date}"`);
    csvContent += newRecordValues.join(',') + '\n';
    
    await driveService.files.update({
      fileId: fileId,
      media: {
        mimeType: "text/csv",
        body: Readable.from([csvContent]),
      },
    });
    
    console.log('Registration added successfully');
    res.json({ message: "Registration submitted successfully" });
  } catch (error) {
    console.error("Error in upload:", error);
    res.status(500).json({ error: error.message });
  }
});
// Route to get all registrations
app.get('/registrations', async (req, res) => {
  try {
    const registrations = await readRegistrationsFromDrive();
    res.json(registrations);
  } catch (error) {
    console.error('Error reading registrations from Drive:', error);
    res.status(500).json({ error: 'Failed to read registration data' });
  }
});

// Route to get admin credentials from CSV
app.get('/admins', (req, res) => {
  console.debug('Received request for admin credentials');
  
  try {
    // Use admin credentials from environment variables
    const adminName = process.env.ADMIN_NAME;
    const adminPassword = process.env.ADMIN_PASSWORD;
    
    console.debug('Checking if admin credentials are configured in environment');
    
    if (!adminName || !adminPassword) {
      console.error('Admin credentials not properly configured in environment variables');
      return res.status(500).json({ error: 'Admin configuration error' });
    }
    
    const adminData = {
      username: adminName,
      password: adminPassword
    };
    
    console.debug('Successfully retrieved admin credentials from environment');
    console.debug(`Admin username configured: ${adminName}`);
    
    res.json(adminData);
  } catch (error) {
    console.error('Error retrieving admin data:', error);
    console.debug('Error details:', JSON.stringify(error, null, 2));
    res.status(500).json({ error: 'Failed to retrieve admin data' });
  }
});




// New endpoint to manually clear the Drive CSV
app.post('/clear-csv', async (req, res) => {
  try {
    const driveService = await getDriveService();
    const fileId = await getDriveFileId(driveService);
    
    const formFields = getFormFields();
    const headerRow = formFields.map(field => field.label).join(',') + ',Date\n';
    
    // Update the file with just headers
    await driveService.files.update({
      fileId: fileId,
      media: {
        mimeType: "text/csv",
        body: Readable.from([headerRow]),
      },
    });
    
    console.log('CSV file cleared in Google Drive!');
    res.json({ message: "CSV file cleared successfully" });
  } catch (error) {
    console.error("Error clearing CSV:", error);
    res.status(500).json({ error: "Failed to clear CSV" });
  }
});


// Log environment variables for debugging
console.log("Environment Variables:");
console.log("Admin Name:", process.env.ADMIN_NAME);
console.log("Admin password:", process.env.ADMIN_PASSWORD);

console.log('All environment variables:');
console.log(process.env);

app.listen(5000, () => console.log("Server running on port 5000"));
