
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
app.use(cors());

// Path to the form fields configuration file
const formFieldsPath = path.join(__dirname, "formFields.json");
const driveFolderPath = path.join(__dirname, "driveFolder.json");

// Path to the config file where settings will be stored
const CONFIG_FILE_PATH = path.join(__dirname, 'config.json');

// Path to the formStatus.json file
const formStatusFilePath = path.join(__dirname, "formStatus.json");


// Add these at the top of your server.js file
const submissionQueue = [];
let processingInterval = null;
const BATCH_PROCESSING_INTERVAL = 30000; // 30 seconds
const SMALLER_BATCH_INTERVAL = 5000;


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





// Helper function to read the form status
const readFormStatus = () => {
  try {
    const data = fs.readFileSync(formStatusFilePath, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading form status file:", error);
    // If the file doesn't exist, create it with a default status
    writeFormStatus(true); // Default to active
    return { active: true };
  }
};

// Helper function to write the form status
const writeFormStatus = (status) => {
  try {
    fs.writeFileSync(formStatusFilePath, JSON.stringify({ active: status }, null, 2));
  } catch (error) {
    console.error("Error writing form status file:", error);
  }
};

// Endpoint to get the current form status
app.get("/form-status", (req, res) => {
  try {
    const formStatus = readFormStatus();
    res.json(formStatus);
  } catch (error) {
    console.error("Error reading form status:", error);
    res.status(500).json({ error: "Failed to fetch form status" });
  }
});

// Endpoint to update the form status
app.post("/update-form-status", (req, res) => {
  try {
    const { active } = req.body;

    if (typeof active !== "boolean") {
      return res.status(400).json({ error: "Invalid status value. Expected a boolean." });
    }

    // Update the form status in the JSON file
    writeFormStatus(active);

    res.json({ success: true, message: `Form is now ${active ? "active" : "inactive"}` });
  } catch (error) {
    console.error("Error updating form status:", error);
    res.status(500).json({ error: "Failed to update form status" });
  }
});




// Endpoint to update the form status
app.post("/update-form-status", (req, res) => {
  try {
    const { active } = req.body;

    if (typeof active !== "boolean") {
      return res.status(400).json({ error: "Invalid status value. Expected a boolean." });
    }

    // Update the form status in the JSON file
    writeFormStatus(active);

    res.json({ success: true, message: `Form is now ${active ? "active" : "inactive"}` });
  } catch (error) {
    console.error("Error updating form status:", error);
    res.status(500).json({ error: "Failed to update form status" });
  }
});

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




// Function to read event description from storage
async function readEventDescriptionFromStorage() {
  const config = await readConfigFile();
  return config.eventDescription || '';
}

// Function to save event description to storage
async function saveEventDescriptionToStorage(eventDescription) {
  const config = await readConfigFile();
  config.eventDescription = eventDescription;
  await writeConfigFile(config);
}


// GET endpoint to retrieve the current event description
app.get("/event-description", async (req, res) => {
  try {
    const eventDescription = await readEventDescriptionFromStorage();
    res.json({ eventDescription });
  } catch (error) {
    console.error("Error fetching event description:", error);
    res.status(500).json({ error: "Failed to fetch event description" });
  }
});

// POST endpoint to update the event description
app.post("/update-event-description", async (req, res) => {
  try {
    const { eventDescription } = req.body;
    
    // Save event description to config file
    await saveEventDescriptionToStorage(eventDescription);
    
    res.json({ success: true, message: "Event description updated successfully" });
  } catch (error) {
    console.error("Error updating event description:", error);
    res.status(500).json({ error: "Failed to update event description" });
  }
});

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
// Replace your /admin/login endpoint with this corrected version
app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  
  console.log("Admin login attempt:", username);
  
  // Check both possible environment variable names
  const adminUsername = process.env.ADMIN_USERNAME || process.env.ADMIN_NAME;
  const adminPassword = process.env.ADMIN_PASSWORD;

  // Log the actual values being compared (without showing the full password)
  console.log("Checking credentials:");
  console.log("- Request username:", username);
  console.log("- ENV username:", adminUsername);
  console.log("- Password match:", password === adminPassword);
  
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



// Update the upload endpoint to use the queue
app.post("/upload", async (req, res) => {
  try {
    const formFields = getFormFields();
    const timestamp = new Date().toISOString();
    
    console.log("Incoming form data:", JSON.stringify(req.body));
    
    // Process the form data into a record
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
    
    console.log("Record added to queue:", JSON.stringify(record));
    
    // Add the record to the queue
    submissionQueue.push(record);
    
    // Make sure the batch processing interval is running
    startBatchProcessing();
    
    // If the queue is getting big, process immediately
    if (submissionQueue.length > 10) {
      processBatchSubmissions().catch(err => {
        console.error("Error during immediate batch processing:", err);
      });
    }
    
    res.json({ message: "Registration submitted successfully" });
  } catch (error) {
    console.error("Error in upload:", error);
    res.status(500).json({ error: error.message });
  }
});

// Start the batch processing when the server starts
startBatchProcessing();

// Add a cleanup function to process any remaining submissions when the server shuts down
process.on('SIGINT', async () => {
  console.log('Server shutting down, processing remaining submissions...');
  if (processingInterval) {
    clearInterval(processingInterval);
    processingInterval = null;
  }
  
  // Process in smaller batches during shutdown
  while (submissionQueue.length > 0) {
    try {
      await processBatchSubmissions();
    } catch (error) {
      console.error("Error during shutdown processing:", error);
      break;
    }
  }
  
  console.log('Graceful shutdown complete');
  process.exit(0);
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




// Function to start the batch processing timer
function startBatchProcessing() {
  if (processingInterval === null) {
    console.log('Starting batch processing interval');
    processingInterval = setInterval(() => {
      // Check if there are items in the queue
      if (submissionQueue.length > 0) {
        processBatchSubmissions();
        
        // If there are still items after processing, schedule a quicker follow-up
        if (submissionQueue.length > 0) {
          // Clear the regular interval
          clearInterval(processingInterval);
          
          // Set a shorter interval temporarily
          processingInterval = setInterval(() => {
            processBatchSubmissions();
            
            // If queue is empty, go back to regular interval
            if (submissionQueue.length === 0) {
              clearInterval(processingInterval);
              processingInterval = setInterval(processBatchSubmissions, BATCH_PROCESSING_INTERVAL);
            }
          }, SMALLER_BATCH_INTERVAL);
        }
      }
    }, BATCH_PROCESSING_INTERVAL);
  }
}

// Function to process all queued submissions
async function processBatchSubmissions() {
  if (submissionQueue.length === 0) {
    console.log('No submissions to process');
    return;
  }

  // Process at most 50 submissions at once (reduce chance of timeout)
  const batchSize = Math.min(50, submissionQueue.length);
  console.log(`Processing batch of ${batchSize} submissions (${submissionQueue.length} total in queue)`);
  
  try {
    // Get Drive service and file ID once for the batch
    const driveService = await getDriveService();
    const fileId = await getDriveFileId(driveService);
    
    // Get the latest version of the file
    const existingCSV = await driveService.files.get({
      fileId: fileId,
      alt: 'media'
    }).catch(err => {
      // If file doesn't exist yet, return empty data
      if (err.code === 404) return { data: '' };
      throw err;
    });
    
    // Parse existing data
    let existingData = [];
    if (existingCSV.data && existingCSV.data.trim()) {
      existingData = await readRegistrationsFromDrive();
    }
    
    // Get form fields
    const formFields = getFormFields();
    
    // Prepare headers
    const headers = formFields.map(field => field.label);
    headers.push('Date');
    
    // Create CSV content with headers
    let csvContent = headers.join(',') + '\n';
    
    // Add existing data
    if (existingData.length > 0) {
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
    }
    
    // Copy the batch to process and remove from queue
    const batchToProcess = submissionQueue.splice(0, batchSize);
    
    // Add all new records from the batch
    batchToProcess.forEach(record => {
      const newRecordValues = formFields.map(field => {
        const value = record[field.key] || '';
        return `"${value.toString().replace(/"/g, '""')}"`;
      });
      newRecordValues.push(`"${record.date}"`);
      csvContent += newRecordValues.join(',') + '\n';
    });
    
    // Update the file on Drive with retry logic
    let success = false;
    let retries = 0;
    const maxRetries = 3; // Fewer retries for faster processing
    const baseDelay = 200; // 200ms initial delay
    
    while (!success && retries < maxRetries) {
      try {
        await driveService.files.update({
          fileId: fileId,
          media: {
            mimeType: "text/csv",
            body: Readable.from([csvContent]),
          },
        });
        
        console.log(`Successfully processed batch of ${batchToProcess.length} submissions`);
        success = true;
      } catch (error) {
        // If it's a conflict error (412) or other potentially recoverable error
        if (error.code === 412 || error.code === 429 || error.code >= 500) {
          retries++;
          const delay = baseDelay * Math.pow(2, retries) + Math.random() * 100;
          console.log(`Retry attempt ${retries} after ${delay}ms due to error:`, error);
          
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          // Non-recoverable error
          console.error("Error updating Drive file:", error);
          // Put the failed submissions back in the queue
          submissionQueue.unshift(...batchToProcess);
          return;
        }
      }
    }
    
    if (!success) {
      console.error(`Failed to process batch after ${maxRetries} attempts`);
      // Put the failed submissions back in the queue
      submissionQueue.unshift(...batchToProcess);
    }
  } catch (error) {
    console.error("Error processing batch submissions:", error);
  }
}

// Add a keep-alive endpoint to prevent Render from spinning down
app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy",
    queueLength: submissionQueue.length 
  });
});





// Log environment variables for debugging
console.log("Environment Variables:");
console.log("Admin Name:", process.env.ADMIN_NAME);
console.log("Admin password:", process.env.ADMIN_PASSWORD);

console.log('All environment variables:');
console.log(process.env);

app.listen(5000, () => console.log("Server running on port 5000"));
