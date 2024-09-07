import React, { useState, useEffect, useRef } from 'react';
import { Typography, Paper, TextField, Button, Box, Grid, Card, CardContent, CardActions, Skeleton } from '@mui/material';
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  const itemType = siteName.toLowerCase().replace(/\s+/g, '-');

  // Reset state when siteName or initialPrompt changes
  useEffect(() => {
    setPrompt(initialPrompt);
    setSavedPrompt(initialPrompt);
    setShowPromptInput(!initialPrompt);
    setCards([]);
    fetchedRef.current = false;
  }, [siteName, initialPrompt]);

  // Fetch items when savedPrompt or siteName changes
  useEffect(() => {
    const fetchSiteItems = async () => {
      if (!savedPrompt || savedPrompt === '') return;
      if (fetchedRef.current) return;
      fetchedRef.current = true;
      
      setLoading(true);
      setError(null);
      try {
        const promptToUse = savedPrompt || initialPrompt;
        const response = await fetch(`${backendUrl}/site-items?prompt=${encodeURIComponent(promptToUse)}&item_type=${encodeURIComponent(itemType)}&limit=12`);
        if (!response.ok) {
          throw new Error('Failed to fetch site items');
        }
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();

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
                  setLoading(false);
                } else {
                  fetchedCards.push(data);
                }
              } catch (error) {
                console.error('Error parsing SSE data:', error);
              }
            }
          }
        }

        setCards(fetchedCards);
        setLoading(false);
      } catch (err) {
        console.error('Error fetching site items:', err);
        setError(err instanceof Error ? err.message : 'An error occurred');
        setLoading(false);
      }
    };

    fetchSiteItems();
  }, [savedPrompt]);

  const handlePromptChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setPrompt(event.target.value);
  };

  const handleSave = () => {
    if (prompt.trim()) {
      setSavedPrompt(prompt.trim());
      setPrompt('');
      setShowPromptInput(false);
      onPromptSave(prompt.trim());
      fetchedRef.current = false;
    }
  };

  const handleKeyPress = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleSave();
    }
  };

  const PlaceholderCard = () => (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ flexGrow: 1 }}>
        <Skeleton variant="circular" width={40} height={40} sx={{ marginBottom: 2 }} />
        <Skeleton variant="text" sx={{ fontSize: '1.5rem', marginBottom: 1 }} />
        <Skeleton variant="text" sx={{ fontSize: '1rem' }} />
        <Skeleton variant="text" sx={{ fontSize: '1rem' }} />
      </CardContent>
      <CardActions>
        <Skeleton variant="rectangular" width={100} height={36} />
      </CardActions>
    </Card>
  );

  if (error) {
    return <Typography color="error">{error}</Typography>;
  }

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
        {savedPrompt && (loading
          ? Array.from(new Array(12)).map((_, index) => (
              <Grid item xs={12} sm={6} md={4} key={`placeholder-${index}`}>
                <PlaceholderCard />
              </Grid>
            ))
          : cards.map((card, index) => (
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
            )))}

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