const { spawn } = require('child_process');
const path = require('path');

// Ensure node.js is in PATH
const nodePath = 'C:\\Program Files\\nodejs';
process.env.PATH = `${process.env.PATH};${nodePath}`;

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('No command specified.');
  process.exit(1);
}

const command = args[0];
const cmdArgs = args.slice(1);

console.log(`Running: ${command} ${cmdArgs.join(' ')}`);

const child = spawn(command, cmdArgs, {
  stdio: 'inherit',
  shell: true,
  env: process.env
});

child.on('close', (code) => {
  process.exit(code);
});
