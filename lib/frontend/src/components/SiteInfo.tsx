import React, { useState } from 'react';
import { Typography, Paper, TextField, Button, Box } from '@mui/material';

interface SiteInfoProps {
  siteName: string;
}

const SiteInfo: React.FC<SiteInfoProps> = ({ siteName }) => {
  const [prompt, setPrompt] = useState('');

  const handlePromptChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setPrompt(event.target.value);
  };

  const handleSubmit = () => {
    // TODO: Implement submission logic
    console.log('Submitted prompt:', prompt);
  };

  return (
    <Paper elevation={3} sx={{ padding: 3, marginTop: 2 }}>
      <Typography variant="h4" gutterBottom>
        {siteName}
      </Typography>
      <Box component="form" noValidate autoComplete="off" sx={{ mt: 2 }}>
        <TextField
          fullWidth
          multiline
          rows={4}
          variant="outlined"
          label="Enter your prompt"
          value={prompt}
          onChange={handlePromptChange}
          sx={{ mb: 2 }}
        />
        <Button variant="contained" color="primary" onClick={handleSubmit}>
          Submit
        </Button>
      </Box>
    </Paper>
  );
};

export default SiteInfo;