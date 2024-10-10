import React, { useState, useEffect, KeyboardEvent } from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate, useNavigate } from 'react-router-dom';
import Ideator from './components/Ideator';
import ChatBot from './components/ChatBot';
import SiteInfo from './components/SiteInfo';
import IdeaDetails from './components/IdeaDetails';
import { Box, Container, AppBar, Toolbar, Typography, Button, 
  IconButton, TextField, List, ListItem, ListItemText, Drawer, Divider, ListItemIcon } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import AddIcon from '@mui/icons-material/Add';
import MenuIcon from '@mui/icons-material/Menu';
import ChatIcon from '@mui/icons-material/Chat';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import CatalogIcon from '@mui/icons-material/Book';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { IconName } from '@fortawesome/fontawesome-svg-core';
import './App.css';
import { faGlasses, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';

// Custom hook to fetch config
const useConfig = () => {
  const [config, setConfig] = useState<{ 
    backendUrl: string,
    customerName: string
  } >({
    backendUrl: 'localhost:5000/api',
    customerName: 'Test Customer'
  });
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

interface Catalog {
  id: string;
  name: string;
  route: string;
  prompt: string;
  generateImages: boolean;
  icon: IconName;
}

interface ProductIdeator {
  id: string;
  name: string;
  route: string;
  prompt: string;
  generateImages: boolean;
}

const App: React.FC = () => {
  const { config, loading, error } = useConfig();
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [productIdeators, setProductIdeators] = useState<ProductIdeator[]>([]);
  const [isAddingCatalog, setIsAddingCatalog] = useState(false);
  const [isAddingIdeator, setIsAddingIdeator] = useState(false);
  const [newCatalogName, setNewCatalogName] = useState('');
  const [newIdeatorName, setNewIdeatorName] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    if (config && config.backendUrl) {
      fetchCatalogs();
      fetchProductIdeators();
    }
  }, [config]);

  const fetchCatalogs = async () => {
    try {
      const response = await fetch(`${config.backendUrl}/catalogs`);
      if (!response.ok) {
        throw new Error('Failed to fetch catalogs');
      }
      const data = await response.json();
      setCatalogs(data);
    } catch (error) {
      console.error('Error fetching catalogs:', error);
    }
  };

  const fetchProductIdeators = async () => {
    try {
      const response = await fetch(`${config.backendUrl}/ideators`);
      if (!response.ok) {
        throw new Error('Failed to fetch product ideators');
      }
      const data = await response.json();
      setProductIdeators(data);
    } catch (error) {
      console.error('Error fetching product ideators:', error);
    }
  };

  const handleAddCatalog = async (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && newCatalogName.trim()) {
      const newRoute = `/catalog/${newCatalogName.toLowerCase().replace(/\s+/g, '-')}`;
      try {
        const response = await fetch(`${config.backendUrl}/catalogs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: newCatalogName.trim(),
            route: newRoute,
            prompt: '',
            generateImages: false
          }),
        });
        if (!response.ok) {
          throw new Error('Failed to add catalog');
        }
        const newCatalog = await response.json();
        setCatalogs(prevCatalogs => [...prevCatalogs, newCatalog]);
        setNewCatalogName('');
        setIsAddingCatalog(false);
        navigate(newRoute);
      } catch (error) {
        console.error('Error adding catalog:', error);
      }
    }
  };

  const handleAddProductIdeator = async (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && newIdeatorName.trim()) {
      const newRoute = `/ideator/${newIdeatorName.toLowerCase().replace(/\s+/g, '-')}`;
      try {
        const response = await fetch(`${config.backendUrl}/ideators`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: newIdeatorName.trim(),
            route: newRoute,
            prompt: '',
            generateImages: false
          }),
        });
        if (!response.ok) {
          throw new Error('Failed to add product ideator');
        }
        const newIdeator = await response.json();
        setProductIdeators(prevIdeators => [...prevIdeators, newIdeator]);
        setNewIdeatorName('');
        setIsAddingIdeator(false);
        navigate(newRoute);
      } catch (error) {
        console.error('Error adding product ideator:', error);
      }
    }
  };

  const handleCatalogPromptSave = async (catalogId: string, prompt: string, generateImages: boolean) => {
    try {
      const response = await fetch(`${config.backendUrl}/catalogs/${catalogId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt, generateImages }),
      });
      if (!response.ok) {
        throw new Error('Failed to update catalog');
      }
      const updatedCatalog = await response.json();
      setCatalogs(prevCatalogs => prevCatalogs.map(catalog => 
        catalog.id === catalogId ? { ...catalog, prompt, generateImages } : catalog
      ));
    } catch (error) {
      console.error('Error updating catalog:', error);
    }
  };

  const handleTabDelete = async (catalogId: string) => {
    try {
      const response = await fetch(`${config.backendUrl}/catalogs/${catalogId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error('Failed to delete catalog');
      }
      setCatalogs(prevCatalogs => prevCatalogs.filter(catalog => catalog.id !== catalogId));
    } catch (error) {
      console.error('Error deleting catalog:', error);
    }
  };

  const handleIdeatorPromptSave = async (ideatorId: string, prompt: string, generateImages: boolean) => {
    try {
      const response = await fetch(`${config.backendUrl}/ideators/${ideatorId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt, generateImages }),
      });
      if (!response.ok) {
        throw new Error('Failed to update ideator');
      }
      const updatedIdeator = await response.json();
      setProductIdeators(prevIdeators => prevIdeators.map(ideator => 
        ideator.id === ideatorId ? { ...ideator, prompt, generateImages } : ideator
      ));
    } catch (error) {
      console.error('Error updating ideator:', error);
    }
  };

  const handleIdeatorDelete = async (ideatorId: string) => {
    try {
      const response = await fetch(`${config.backendUrl}/ideators/${ideatorId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error('Failed to delete product ideator');
      }
      setProductIdeators(prevIdeators => prevIdeators.filter(ideator => ideator.id !== ideatorId));
    } catch (error) {
      console.error('Error deleting product ideator:', error);
    }
  };

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error loading config: {error.message}</div>;
  if (!config) return <div>Config not available</div>;

  document.title = `${config.customerName} AI Assistant`;

  const drawer = (
    <Box className="sidebar">
      <List>
        <ListItem button component={RouterLink} to="/" className="sidebar-item chat-item">
          <ListItemIcon>
            <ChatIcon />
          </ListItemIcon>
          <ListItemText primary="Chat" />
        </ListItem>
      </List>
      <Divider />
      <Typography variant="h6" className="sidebar-header">
        Site Catalogs
      </Typography>
      <List>
        <ListItem button component={RouterLink} to="/products" className="sidebar-item">
          <ListItemIcon>
            <ShoppingCartIcon />
          </ListItemIcon>
          <ListItemText primary="Products" />
        </ListItem>
        {catalogs.map((catalog, index) => (
          console.log(catalog),
          <ListItem key={catalog.id} button component={RouterLink} to={catalog.route} className="sidebar-item">
            <ListItemIcon>
              {catalog.icon ? (
                <FontAwesomeIcon 
                  icon={['fas', catalog.icon]}
                />
              ) : (
                <AddIcon />
              )}
            </ListItemIcon>
            <ListItemText primary={catalog.name} />
          </ListItem>
        ))}
        <ListItem>
          {isAddingCatalog ? (
            <TextField
              size="small"
              variant="outlined"
              placeholder="New catalog name"
              value={newCatalogName}
              onChange={(e) => setNewCatalogName(e.target.value)}
              onKeyPress={handleAddCatalog}
              fullWidth
              className="add-catalog-input"
            />
          ) : (
            <Button
              startIcon={<AddIcon />}
              onClick={() => setIsAddingCatalog(true)}
              fullWidth
              className="add-catalog-button"
            >
              Add Catalog
            </Button>
          )}
        </ListItem>
      </List>
      <Divider />
      <Typography variant="h6" className="sidebar-header">
        Product Ideator
      </Typography>
      <List>
        {productIdeators.map((ideator, index) => (
          <ListItem key={ideator.id} button component={RouterLink} to={ideator.route} className="sidebar-item">
            <ListItemIcon>
              <LightbulbIcon />
            </ListItemIcon>
            <ListItemText primary={ideator.name} />
          </ListItem>
        ))}
        <ListItem>
          {isAddingIdeator ? (
            <TextField
              size="small"
              variant="outlined"
              placeholder="New ideator name"
              value={newIdeatorName}
              onChange={(e) => setNewIdeatorName(e.target.value)}
              onKeyPress={handleAddProductIdeator}
              fullWidth
              className="add-ideator-input"
            />
          ) : (
            <Button
              startIcon={<AddIcon />}
              onClick={() => setIsAddingIdeator(true)}
              fullWidth
              className="new-product-idea-button"
            >
              New Product Idea
            </Button>
          )}
        </ListItem>
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', height: '100vh' }}>
      <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
        
        <Toolbar>
        
          <IconButton
            color="inherit"
            aria-label="toggle drawer"
            edge="start"
            onClick={() => setDrawerOpen(!drawerOpen)}
            sx={{ mr: 2, display: { sm: 'none' } }}
          >
            <MenuIcon />
          </IconButton>
          <FontAwesomeIcon icon={faMagnifyingGlass} />
          <Typography variant="h6" noWrap component="div" ml={2}>
              Amazon Bedrock WebLens for {config.customerName} 
          </Typography>
        </Toolbar>
      </AppBar>
      <Drawer
        variant="permanent"
        open={true}
        sx={{
          width: 250,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: { width: 250, boxSizing: 'border-box' },
          display: { xs: 'none', sm: 'block' }
        }}
      >
        <Toolbar />
        {drawer}
      </Drawer>
      <Drawer
        variant="temporary"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        ModalProps={{
          keepMounted: true,
        }}
        sx={{
          display: { xs: 'block', sm: 'none' },
          '& .MuiDrawer-paper': { boxSizing: 'border-box', width: 250 },
        }}
      >
        {drawer}
      </Drawer>
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: 3,
          width: { sm: `calc(100% - 250px)` },
          height: '100vh',
          overflow: 'auto',
          mt: '64px', // Add top margin to account for AppBar height
        }}
      >
        <Container maxWidth="lg">
          <Routes>
            <Route path="/" element={<ChatBot backendUrl={config.backendUrl} customerName={config.customerName} />} />
            <Route
              key="products"
              path="/products"
              element={
                <SiteInfo
                  siteName="Products"
                  initialPrompt="a list of products and services"
                  initialGenerateImages={true}
                  onPromptSave={(prompt: string, generateImages: boolean) => handleCatalogPromptSave('products', prompt, generateImages)}
                  onTabDelete={() => {}} // Products tab can't be deleted
                  backendUrl={config.backendUrl}
                />
              }
            />
            {catalogs.map((catalog) => (
              <Route 
                key={catalog.id} 
                path={catalog.route} 
                element={
                  <SiteInfo 
                    siteName={catalog.name} 
                    initialPrompt={catalog.prompt}   
                    initialGenerateImages={catalog.generateImages}
                    onPromptSave={(prompt: string, generateImages: boolean) => handleCatalogPromptSave(catalog.id, prompt, generateImages)}
                    onTabDelete={() => handleTabDelete(catalog.id)}
                    backendUrl={config.backendUrl}
                  />
                } 
              />
            ))}
            {productIdeators.map((ideator) => (
              <Route
                key={ideator.id}
                path={ideator.route}
                element={
                  <Ideator
                    ideaName={ideator.name}
                    backendUrl={config.backendUrl}
                    onDelete={() => handleIdeatorDelete(ideator.id)}
                    initialPrompt={ideator.prompt}
                    initialGenerateImages={ideator.generateImages}
                    onPromptSave={(prompt: string, generateImages: boolean) => handleIdeatorPromptSave(ideator.id, prompt, generateImages)}
                  />
                }
              />
            ))}
            <Route path="/ideator/:ideatorName/idea/:ideaTitle" element={<IdeaDetails backendUrl={config.backendUrl} customerName={config.customerName} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Container>
      </Box>
    </Box>
  );
};

const AppWrapper: React.FC = () => (
  <Router>
    <App />
  </Router>
);

export default AppWrapper;