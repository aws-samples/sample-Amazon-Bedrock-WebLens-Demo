import React, { useState, useEffect, useRef } from 'react';
import { Typography, Paper, TextField, Button, Box, Grid, Card, CardContent, CardActions, Skeleton, Checkbox, FormControlLabel, CardMedia, IconButton, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { library } from '@fortawesome/fontawesome-svg-core';
import { fas } from '@fortawesome/free-solid-svg-icons';
import AddIcon from '@mui/icons-material/Add';
import CircularProgress from '@mui/material/CircularProgress';
import DeleteIcon from '@mui/icons-material/Delete';
import { useNavigate } from 'react-router-dom';

library.add(fas);

interface SiteInfoProps {
  backendUrl: string;
  siteName: string;
  initialPrompt: string;
  initialGenerateImages: boolean;
  onPromptSave: (prompt: string, generateImages: boolean) => void;
  onTabDelete: (tabName: string) => void;
}

interface CardData {
  title: string;
  description: string;
  icon: string;
  image?: string;  // Add this line to include the image field
}

const Spinner = () => (
  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
    <CircularProgress />
  </Box>
);

const SiteInfo: React.FC<SiteInfoProps> = ({ siteName, initialPrompt, onPromptSave, backendUrl, onTabDelete }) => {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [savedPrompt, setSavedPrompt] = useState(initialPrompt);
  const [showPromptInput, setShowPromptInput] = useState(!initialPrompt);
  const [cards, setCards] = useState<CardData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [itemLimit, setItemLimit] = useState('12');
  const [generateImages, setGenerateImages] = useState(false);
  const fetchedRef = useRef(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [cardToDelete, setCardToDelete] = useState<CardData | null>(null);
  const [deleteTabDialogOpen, setDeleteTabDialogOpen] = useState(false);
  const navigate = useNavigate();

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
      setCards([]); // Reset cards when starting a new fetch
      try {
        const promptToUse = savedPrompt || initialPrompt;
        const response = await fetch(`${backendUrl}/site-items?prompt=${encodeURIComponent(promptToUse)}&item_type=${encodeURIComponent(itemType)}&limit=${itemLimit}&generate_images=${generateImages}`);
        if (!response.ok) {
          throw new Error('Failed to fetch site items');
        }
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();

        let partialData = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = (partialData + chunk).split('\n');
          partialData = lines.pop() || '';
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === 'stop') {
                  setLoading(false);
                } else {
                  setCards(prevCards => {
                    if (prevCards.some(card => card.title === data.title)) {
                      return prevCards;
                    }
                    return [...prevCards, data];
                  });
                }
              } catch (error) {
                console.warn('Incomplete JSON, waiting for more data');
              }
            }
          }
        }

        // Process any remaining partial data
        if (partialData) {
          try {
            const data = JSON.parse(partialData.slice(6));
            if (data.type !== 'stop') {
              setCards(prevCards => {
                if (prevCards.some(card => card.title === data.title)) {
                  return prevCards;
                }
                return [...prevCards, data];
              });
            }
          } catch (error) {
            console.error('Error parsing final SSE data:', error);
          }
        }

        setLoading(false);
      } catch (err) {
        console.error('Error fetching site items:', err);
        setError(err instanceof Error ? err.message : 'An error occurred');
        setLoading(false);
      }
    };

    fetchSiteItems();
  }, [savedPrompt, itemLimit, generateImages]);

  const handlePromptChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setPrompt(event.target.value);
  };

  const handleItemLimitChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    if (/^\d*$/.test(value) && parseInt(value) > 0) {
      setItemLimit(value);
      fetchedRef.current = false;
    }
  };

  const handleGenerateImagesChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setGenerateImages(event.target.checked);
    fetchedRef.current = false;
  };

  const handleSave = () => {
    if (prompt.trim()) {
      setSavedPrompt(prompt.trim());
      setPrompt('');
      setShowPromptInput(false);
      onPromptSave(prompt.trim(), generateImages);
      fetchedRef.current = false;
    }
  };

  const handleKeyPress = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleSave();
    }
  };

  const handleDeleteClick = (card: CardData) => {
    setCardToDelete(card);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (cardToDelete) {
      try {
        const response = await fetch(`${backendUrl}/site-items`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            item_type: itemType,
            title: cardToDelete.title,
          }),
        });

        if (response.ok) {
          setCards(cards.filter(card => card.title !== cardToDelete.title));
        } else {
          console.error('Failed to delete item');
        }
      } catch (error) {
        console.error('Error deleting item:', error);
      }
    }
    setDeleteDialogOpen(false);
    setCardToDelete(null);
  };

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false);
    setCardToDelete(null);
  };

  const handleDeleteTabClick = () => {
    setDeleteTabDialogOpen(true);
  };

  const handleDeleteTabConfirm = async () => {
    try {
      const response = await fetch(`${backendUrl}/site-items`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          item_type: itemType,
        }),
      });

      if (response.ok) {
        onTabDelete(siteName);
        navigate('/');
      } else {
        console.error('Failed to delete tab');
      }
    } catch (error) {
      console.error('Error deleting tab:', error);
    }
    setDeleteTabDialogOpen(false);
  };

  const handleDeleteTabCancel = () => {
    setDeleteTabDialogOpen(false);
  };

  if (error) {
    return <Typography color="error">{error}</Typography>;
  }

  return (
    <Box sx={{ mt: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4" component="div">
          {siteName}
        </Typography>
        <IconButton
          size="small"
          onClick={handleDeleteTabClick}
          sx={{ ml: 2 }}
        >
          <DeleteIcon />
        </IconButton>
      </Box>

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
              <TextField
                type="number"
                label="Number of items"
                value={itemLimit}
                onChange={handleItemLimitChange}
                variant="outlined"
                sx={{ width: '120px' }}
              />
            </Grid>
            <Grid item>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={generateImages}
                    onChange={handleGenerateImagesChange}
                    name="generateImages"
                    color="primary"
                  />
                }
                label="Generate Images"
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
                    backgroundColor: (() => {
                      const hash = card.title.split('').reduce((acc, char) => {
                        return char.charCodeAt(0) + ((acc << 5) - acc);
                      }, 0);
                      const r = (hash & 0xFF) % 56 + 200;
                      const g = ((hash >> 8) & 0xFF) % 56 + 200;
                      const b = ((hash >> 16) & 0xFF) % 56 + 200;
                      return `rgb(${r}, ${g}, ${b})`;
                    })(),
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    cursor: 'pointer',
                    transition: 'all 0.3s ease-in-out',
                    '&:hover': {
                      boxShadow: 6,
                      transform: 'scale(1.03)',
                    },
                    position: 'relative',
                    '&:hover .delete-button': {
                      opacity: 1,
                    },
                  }}
                >
                  {card.image && (
                    <CardMedia
                      component="img"
                      height="140"
                      image={`data:image/png;base64,${card.image}`}
                      alt={card.title}
                      />
                    )}
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
                  <CardActions sx={{ justifyContent: 'flex-start', position: 'relative' }}>
                    <Button size="small">Learn More</Button>
                  </CardActions>
                  <CardActions sx={{ justifyContent: 'flex-end', position: 'relative' }}>
                    <IconButton
                      className="delete-button"
                      size="medium"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteClick(card);
                      }}
                      sx={{
                        position: 'absolute',
                        bottom: 20,
                        right: 20,
                        opacity: 0,
                        transition: 'opacity 0.3s',
                      }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </CardActions>
                </Card>
              </Grid>
            ))}

        {/* Add New Card */}
        {savedPrompt && (
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
            {savedPrompt && loading ? (              
            <CardContent sx={{ flexGrow: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                <Spinner />
              </CardContent>
              ) : (
            <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <AddIcon sx={{ fontSize: 60, color: '#666' }} />
              <Typography variant="h6" component="div" sx={{ mt: 2 }}>
                Add New Card
              </Typography>
 
            </CardContent>
            )
          }
          </Card>
          </Grid>
        )
      }
   
      </Grid>

      {/* Delete Tab Dialog */}
      <Dialog
        open={deleteTabDialogOpen}
        onClose={handleDeleteTabCancel}
      >
        <DialogTitle>Confirm Tab Deletion</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete this entire tab and all its items?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteTabCancel}>Cancel</Button>
          <Button onClick={handleDeleteTabConfirm} color="error">Delete</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={deleteDialogOpen}
        onClose={handleDeleteCancel}
      >
        <DialogTitle>Confirm Deletion</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete this item?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel}>Cancel</Button>
          <Button onClick={handleDeleteConfirm} color="error">Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SiteInfo;
