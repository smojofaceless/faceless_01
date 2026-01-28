FROM node:18-slim

# Install FFmpeg
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy source
COPY . .

# Create temp directories
RUN mkdir -p /tmp/renders /tmp/outputs

# Expose port
EXPOSE 3001

# Start server
CMD ["npm", "start"]
