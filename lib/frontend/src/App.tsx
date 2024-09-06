import React, { useState, useEffect, KeyboardEvent } from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate, useNavigate } from 'react-router-dom';
import ProductGrid from './components/Products';
import ProductDetails from './components/ProductDetails';
import ChatBot from './components/ChatBot';
import SiteInfo from './components/SiteInfo';
import { Box, Container, AppBar, Toolbar, Typography, Button, IconButton, TextField } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import AddIcon from '@mui/icons-material/Add';

// Custom hook to fetch config
const useConfig = () => {
  const [config, setConfig] = useState<{ 
    backendUrl: string,
    customerName: string
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    fetch('/config.json')
      .then(response => response.json())
      .then(data => {
        setConfig(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err);
        setLoading(false);
      });
  }, []);

  return { config, loading, error };
};

const App: React.FC = () => {
  const { config, loading, error } = useConfig();
  const [sites, setSites] = useState<{ name: string; route: string }[]>([]);
  const [isAddingSite, setIsAddingSite] = useState(false);
  const [newSiteName, setNewSiteName] = useState('');
  const navigate = useNavigate();

  document.title = `${config?.customerName} AI Assistant`;
  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error loading config: {error.message}</div>;
  if (!config) return <div>Config not available</div>;

  const handleAddSite = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && newSiteName.trim()) {
      const newRoute = `/site/${newSiteName.toLowerCase().replace(/\s+/g, '-')}`;
      setSites([...sites, { name: newSiteName.trim(), route: newRoute }]);
      setNewSiteName('');
      setIsAddingSite(false);
      navigate(newRoute);
    }
  };

  return (
    <Box sx={{ flexGrow: 1 }}>
      <AppBar position="static">
        <Toolbar>
          <Typography
            variant="h6"
            component={RouterLink}
            to="/"
            sx={{
              textDecoration: 'none',
              color: 'inherit',
              '&:hover': {
                cursor: 'pointer',
              },
              marginRight: 2,
            }}
          >
            {config.customerName} Assistant
          </Typography>
          <Button color="inherit" component={RouterLink} to="/">
            Chat
          </Button>
          <Button color="inherit" component={RouterLink} to="/products" sx={{ marginRight: 1 }}>
            Products
          </Button>
          {sites.map((site, index) => (
            <Button key={index} color="inherit" component={RouterLink} to={site.route}>
              {site.name}
            </Button>
          ))}
          {isAddingSite ? (
            <TextField
              size="small"
              variant="outlined"
              placeholder="New tab name"
              value={newSiteName}
              onChange={(e) => setNewSiteName(e.target.value)}
              onKeyPress={handleAddSite}
              sx={{ 
                backgroundColor: 'white',
                borderRadius: 1,
                marginLeft: 1,
                '& .MuiOutlinedInput-root': {
                  '& fieldset': {
                    borderColor: 'transparent',
                  },
                  '&:hover fieldset': {
                    borderColor: 'transparent',
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: 'transparent',
                  },
                },
              }}
            />
          ) : (
            <IconButton color="inherit" onClick={() => setIsAddingSite(true)} size="large" sx={{ marginLeft: 1 }}>
              <AddIcon />
            </IconButton>
          )}
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ mt: 4 }}>
        <Routes>
          <Route path="/" element={<ChatBot backendUrl={config.backendUrl} customerName={config.customerName} />} />
          <Route path="/products" element={<ProductGrid backendUrl={config.backendUrl} />} />
          <Route path="/product/:productName" element={<ProductDetails backendUrl={config.backendUrl} />} />
          {sites.map((site, index) => (
            <Route key={index} path={site.route} element={<SiteInfo siteName={site.name} />} />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Container>
    </Box>
  );
};

const AppWrapper: React.FC = () => (
  <Router>
    <App />
  </Router>
);

export default AppWrapper;