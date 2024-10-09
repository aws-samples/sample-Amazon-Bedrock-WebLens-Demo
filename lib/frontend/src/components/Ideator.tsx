import React, { useState, useEffect, useRef } from 'react';
import { Typography, Paper, TextField, Button, Box, Grid, Card, CardContent, CardActions, Checkbox, FormControlLabel, CardMedia, IconButton, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { library } from '@fortawesome/fontawesome-svg-core';
import { fas } from '@fortawesome/free-solid-svg-icons';
import AddIcon from '@mui/icons-material/Add';
import CircularProgress from '@mui/material/CircularProgress';
import DeleteIcon from '@mui/icons-material/Delete';
import { useNavigate, useParams } from 'react-router-dom';

library.add(fas);

interface IdeatorProps {
  backendUrl: string;
  ideaName: string;
  initialPrompt: string;
  initialGenerateImages: boolean;
  onPromptSave: (prompt: string, generateImages: boolean) => void;
  onDelete: () => void;
}

interface IdeaCardData {
  title: string;
  description: string;
  icon: string;
  image?: string;
  link?: string;
}

const Spinner = () => (
  <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
    <CircularProgress />
  </Box>
);

const Ideator: React.FC<IdeatorProps> = ({ backendUrl, ideaName, initialPrompt, initialGenerateImages, onPromptSave, onDelete }) => {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [savedPrompt, setSavedPrompt] = useState(initialPrompt);
  const [showPromptInput, setShowPromptInput] = useState(!initialPrompt);
  const [ideas, setIdeas] = useState<IdeaCardData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [itemLimit, setItemLimit] = useState('6');
  const [generateImages, setGenerateImages] = useState(initialGenerateImages);
  const fetchedRef = useRef(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [ideaToDelete, setIdeaToDelete] = useState<IdeaCardData | null>(null);
  const [deleteIdeatorDialogOpen, setDeleteIdeatorDialogOpen] = useState(false);
  const navigate = useNavigate();

  const itemType = ideaName.toLowerCase().replace(/\s+/g, '-');
  fetchedRef.current = false;
  useEffect(() => {
    setPrompt(initialPrompt);
    setSavedPrompt(initialPrompt);
    setShowPromptInput(!initialPrompt);
    setIdeas([]);
  }, [ideaName, initialPrompt]);

  useEffect(() => {
    const fetchIdeas = async () => {
      if (!savedPrompt || savedPrompt === '') return;
      if (fetchedRef.current) return;
      fetchedRef.current = true;
      
      setLoading(true);
      setError(null);
      setIdeas([]);
      try {
        const promptToUse = savedPrompt || initialPrompt;
        const response = await fetch(`${backendUrl}/idea-items?prompt=${encodeURIComponent(promptToUse)}&item_type=${encodeURIComponent(itemType)}&limit=${itemLimit}&generate_images=${generateImages}`);
        if (!response.ok) {
          throw new Error('Failed to fetch ideas');
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
                  setIdeas(prevCards => {
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
              setIdeas(prevCards => {
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
        console.error('Error fetching ideas:', err);
        setError(err instanceof Error ? err.message : 'An error occurred');
        setLoading(false);
      }
    };

    fetchIdeas();
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

  const handleSave = async () => {
    if (prompt.trim()) {
      onPromptSave(prompt.trim(), generateImages);
      setSavedPrompt(prompt.trim());
      setPrompt('');
      setShowPromptInput(false);
      fetchedRef.current = false;
    }
  };

  const handleKeyPress = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleSave();
    }
  };

  const handleDeleteClick = (idea: IdeaCardData) => {
    setIdeaToDelete(idea);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (ideaToDelete) {
      try {
        const response = await fetch(`${backendUrl}/idea-items`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            item_type: itemType,
            title: ideaToDelete.title,
          }),
        });

        if (response.ok) {
          setIdeas(prevIdeas => prevIdeas.filter(idea => idea.title !== ideaToDelete.title));
        } else {
          console.error('Failed to delete idea');
        }
      } catch (error) {
        console.error('Error deleting idea:', error);
      }
    }
    setDeleteDialogOpen(false);
  };

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false);
  };

  const handleDeleteIdeatorClick = () => {
    setDeleteIdeatorDialogOpen(true);
  };

  const handleDeleteIdeatorConfirm = async () => {
    try {
      const response = await fetch(`${backendUrl}/ideators/${encodeURIComponent(ideaName)}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          item_type: itemType,
        }),
      });

      if (response.ok) {
        onDelete();
        navigate('/');
      } else {
        console.error('Failed to delete ideator');
      }
    } catch (error) {
      console.error('Error deleting ideator:', error);
    }
    setDeleteIdeatorDialogOpen(false);
  };

  const handleDeleteIdeatorCancel = () => {
    setDeleteIdeatorDialogOpen(false);
  };

  if (error) {
    return <Typography color="error">{error}</Typography>;
  }

  return (
    <Box sx={{ mt: 10, mb: 15 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4" component="div">
          {ideaName}
        </Typography>
        <IconButton
          size="small"
          onClick={handleDeleteIdeatorClick}
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
        {ideas.map((idea, index) => (
          <Grid item xs={12} sm={6} md={4} key={index}>
            <Card 
              sx={{ 
                backgroundColor: (() => {
                  const hash = idea.title.split('').reduce((acc, char) => {
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
              onClick={() => navigate(`/ideator/${encodeURIComponent(ideaName)}/idea/${encodeURIComponent(idea.title)}`)}
            >
              {idea.image && (
                <CardMedia
                  component="img"
                  height="140"
                  image={`data:image/png;base64,${idea.image}`}
                  alt={idea.title}
                />
              )}
              <CardContent sx={{ flexGrow: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
                  <FontAwesomeIcon icon={['fas', idea.icon as any]} size="2x" style={{ marginRight: '16px' }} />
                  <Typography variant="h5" component="div">
                    {idea.title}
                  </Typography>
                </Box>
                <Typography variant="body2" color="text.secondary">
                  {idea.description}
                </Typography>
              </CardContent>
              <CardActions sx={{ justifyContent: 'flex-start', position: 'relative' }}>
                <Button size="small" component="a" href={idea.link} target="_blank" rel="noopener noreferrer">Learn More</Button>
              </CardActions>
              <CardActions sx={{ justifyContent: 'flex-end', position: 'relative' }}>
                <IconButton
                  className="delete-button"
                  size="medium"
                  onClick={() => handleDeleteClick(idea)}
                  sx={{
                    position: 'absolute',
                    bottom: 8,
                    right: 8,
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
        {savedPrompt && loading && (
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
                <CardContent sx={{ flexGrow: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                  <Spinner />
                </CardContent>
            </Card>
          </Grid>
        )}
      </Grid>

      <Dialog
        open={deleteIdeatorDialogOpen}
        onClose={handleDeleteIdeatorCancel}
      >
        <DialogTitle>Confirm Ideator Deletion</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete this entire ideator and all its ideas?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteIdeatorCancel}>Cancel</Button>
          <Button onClick={handleDeleteIdeatorConfirm} color="error">Delete</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={deleteDialogOpen}
        onClose={handleDeleteCancel}
      >
        <DialogTitle>Confirm Deletion</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete this idea?
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

export default Ideator;