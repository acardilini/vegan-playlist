const { spawn } = require('child_process');

console.log('🔄 Restarting backend server...');

// Kill existing node processes (Windows specific)
const killProcesses = spawn('taskkill', ['/F', '/IM', 'node.exe'], { stdio: 'inherit' });

killProcesses.on('close', (code) => {
  console.log('Killed existing processes');
  
  // Wait a moment then start the server
  setTimeout(() => {
    console.log('🚀 Starting backend server...');
    const server = spawn('npm', ['run', 'dev'], { 
      stdio: 'inherit',
      cwd: process.cwd()
    });
    
    server.on('close', (code) => {
      console.log(`Server exited with code ${code}`);
    });
    
  }, 2000);
});