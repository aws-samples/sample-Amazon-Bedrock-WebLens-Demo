import React, { useState, useEffect } from 'react';
import { Typography, Paper, TextField, Button, Box, Grid, Card, CardContent, CardActions } from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { library } from '@fortawesome/fontawesome-svg-core';
import { fas } from '@fortawesome/free-solid-svg-icons';
import AddIcon from '@mui/icons-material/Add';

library.add(fas);

interface SiteInfoProps {
  backendUrl: string;
  siteName: string;
  initialPrompt: string;
  onPromptSave: (prompt: string) => void;
}

interface CardData {
  title: string;
  description: string;
  icon: string;
}

const SiteInfo: React.FC<SiteInfoProps> = ({ siteName, initialPrompt, onPromptSave, backendUrl }) => {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [savedPrompt, setSavedPrompt] = useState(initialPrompt);
  const [showPromptInput, setShowPromptInput] = useState(!initialPrompt);
  const [cards, setCards] = useState<CardData[]>([]);

  useEffect(() => {
    if (initialPrompt) {
      fetchSiteItems(initialPrompt);
    }
  }, [initialPrompt]);

  const handlePromptChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setPrompt(event.target.value);
  };

  const handleSave = () => {
    if (prompt.trim()) {
      setSavedPrompt(prompt.trim());
      setPrompt('');
      setShowPromptInput(false);
      onPromptSave(prompt.trim());
      fetchSiteItems(prompt.trim());
    }
  };

  const handleKeyPress = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleSave();
    }
  };

  const fetchSiteItems = async (prompt: string) => {
    try {
      const response = await fetch(`${backendUrl}/site-items?prompt=${encodeURIComponent(prompt)}&limit=12`);
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        let fetchedCards: CardData[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === 'stop') {
                  setCards(fetchedCards);
                  return;
                } else {
                  fetchedCards.push(data);
                }
              } catch (error) {
                console.error('Error parsing SSE data:', error);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error fetching site items:', error);
    }
  };

  return (
    <Box sx={{ mt: 4 }}>
      <Typography variant="h4" gutterBottom>
        {siteName}
      </Typography>
      {showPromptInput ? (
        <Box component="form" noValidate autoComplete="off" sx={{ mt: 2, mb: 4 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs>
              <TextField
                fullWidth
                variant="outlined"
                label="Enter your prompt"
                value={prompt}
                onChange={handlePromptChange}
                onKeyPress={handleKeyPress}
              />
            </Grid>
            <Grid item>
              <Button variant="contained" color="primary" onClick={handleSave}>
                Save
              </Button>
            </Grid>
          </Grid>
        </Box>
      ) : (
        <Paper elevation={1} sx={{ padding: 2, mt: 2, mb: 4, backgroundColor: '#f5f5f5' }}>
          <Typography variant="body1">{savedPrompt}</Typography>
        </Paper>
      )}

      <Grid container spacing={2}>
        {cards.map((card, index) => (
          <Grid item xs={12} sm={6} md={4} key={index}>
            <Card 
              sx={{ 
                backgroundColor: `rgb(${Math.floor(Math.random() * 56 + 200)}, ${Math.floor(Math.random() * 56 + 200)}, ${Math.floor(Math.random() * 56 + 200)})`,
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                cursor: 'pointer',
                transition: 'all 0.3s ease-in-out',
                '&:hover': {
                  boxShadow: 6,
                  transform: 'scale(1.03)',
                },
              }}
            >
              <CardContent sx={{ flexGrow: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
                  <FontAwesomeIcon icon={['fas', card.icon as any]} size="2x" style={{ marginRight: '16px' }} />
                  <Typography variant="h5" component="div">
                    {card.title}
                  </Typography>
                </Box>
                <Typography variant="body2" color="text.secondary">
                  {card.description}
                </Typography>
              </CardContent>
              <CardActions>
                <Button size="small">Learn More</Button>
              </CardActions>
            </Card>
          </Grid>
        ))}

        {/* Add New Card */}
        <Grid item xs={12} sm={6} md={4}>
          <Card 
            sx={{ 
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: '#f0f0f0',
              cursor: 'pointer',
              transition: 'all 0.3s ease-in-out',
              '&:hover': {
                boxShadow: 6,
                transform: 'scale(1.03)',
              },
            }}
          >
            <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <AddIcon sx={{ fontSize: 60, color: '#666' }} />
              <Typography variant="h6" component="div" sx={{ mt: 2 }}>
                Add New Card
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default SiteInfo;