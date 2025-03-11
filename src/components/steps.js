// steps.js
const steps = [
    { label: "Enter your Name", key: "name", type: "text", isActive: true },
    { label: "Enter your Email", key: "email", type: "email", isActive: true },
    { label: "Enter your Phone", key: "phone", type: "tel", isActive: true },
    { label: "Upload Image", key: "image", type: "file", isActive: false }, // Example of an inactive field
    { label: "Team Name", key: "teamName", type: "text", isActive: false }, // Example of an inactive field
  ];
  
  export default steps;