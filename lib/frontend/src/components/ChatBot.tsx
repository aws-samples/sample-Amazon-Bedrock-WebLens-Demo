import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Box, 
  TextField, 
  Button, 
  Paper, 
  Typography, 
  List, 
  ListItem, 
  Link,
  Container,
  ThemeProvider,
  createTheme,
  CssBaseline,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Collapse,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import LinkIcon from '@mui/icons-material/Link';
import AttachFileIcon from '@mui/icons-material/AttachFile';

interface Message {
  text: string;
  isUser: boolean;
  sources?: string[];
  visualization?: VisualizationData;
}

interface ChatBotProps {
  backendUrl: string;
  customerName: string;
}

interface VisualizationData {
  chart_type: string;
  title: string;
  description: string;
  data: any[];
}

interface UploadedDocument {
  name: string;
  format: string;
  bytes: ArrayBuffer;
}

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1976d2',
    },
    secondary: {
      main: '#dc004e',
    },
  },
});


const ChatBot: React.FC<ChatBotProps> = ({ backendUrl, customerName }) => {
  const [messages, setMessages] = useState<Message[]>([{
    text: `Hello! I am the ${customerName} AI assistant. I can help you with information about ${customerName}'s products and services and create visualizations. How can I help you today?`,
    isUser: false,
  }]);
  const [input, setInput] = useState('');
  const [promptModifier, setPromptModifier] = useState('Informative, empathetic, and friendly');
  const [showPromptModifier, setShowPromptModifier] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [initialSuggestedQuestions, setInitialSuggestedQuestions] = useState<string[]>([]);
  const messagesEndRef = useRef<null | HTMLDivElement>(null);
  const [expandedLinks, setExpandedLinks] = useState<number | null>(null);
  const [uploadedDocument, setUploadedDocument] = useState<UploadedDocument | null>(null);

  
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (messages.length <= 1) {
      fetchInitialSuggestedQuestions();
    }
  }, [backendUrl, messages.length]);

  const fetchInitialSuggestedQuestions = async () => {
    try {
      const response = await fetch(`${backendUrl}/chat-suggested-questions`);
      const data = await response.json();
      
      setInitialSuggestedQuestions(data);
      setSuggestedQuestions(data); // Set initial questions
    } catch (error) {
      console.error('Error fetching suggested questions:', error);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const allowedFormats = ['pdf', 'html', 'docx', 'doc', 'md', 'txt'];
    const fileExtension = file.name.split('.').pop()?.toLowerCase();

    if (!fileExtension || !allowedFormats.includes(fileExtension)) {
      alert('Unsupported file type. Please upload a PDF, HTML, Word, Markdown, or Text file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const bytes = e.target?.result as ArrayBuffer;
      setUploadedDocument({
        name: file.name,
        format: fileExtension,
        bytes: bytes,
      });
    };
    reader.readAsArrayBuffer(file);
  };

  const handleSubmit = async (e: React.FormEvent, questionOverride?: string) => {
    e.preventDefault();
    const questionToSend = questionOverride || input;
    if (!questionToSend.trim() || isLoading) return;

    const userMessage: Message = { text: questionToSend, isUser: true };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      setSuggestedQuestions([]);
      const formData = new FormData();
      formData.append('question', questionToSend);
      formData.append('chat_history', JSON.stringify(messages.map(m => m.text)));
      formData.append('prompt_modifier', promptModifier);
      
      if (uploadedDocument) {
        formData.append('document', new Blob([uploadedDocument.bytes]), uploadedDocument.name);
        formData.append('document_format', uploadedDocument.format);
      }

      const response = await fetch(`${backendUrl}/chat`, {
        method: 'POST',
        body: formData,
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let botMessage: Message = { text: '', isUser: false };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'metadata') {
                botMessage.sources = data.sources;
              } else if (data.type === 'content') {
                botMessage.text += data.content;
              } else if (data.type === 'visualization') {
                botMessage.visualization = data.content;
              } else if (data.type === 'suggested_questions') {
                setSuggestedQuestions(data.content);
              } else if (data.type === 'stop') {
                console.log('Response complete');
              }
              // Update messages after each chunk
              setMessages(prev => {
                const lastMessage = prev[prev.length - 1];
                if (lastMessage.isUser) {
                  return [...prev, { ...botMessage }];
                } else {
                  return [...prev.slice(0, -1), { ...botMessage }];
                }
              });
            } catch (error) {
              console.error('Error parsing SSE data:', error);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error fetching response:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuggestedQuestionClick = (question: string) => {
    handleSubmit({ preventDefault: () => {} } as React.FormEvent, question);
  };

  const renderMessageText = (text: string) => {
    return text.split('<br>').map((paragraph, index) => (
      <Typography key={index} variant="body1" paragraph>
        {paragraph}
      </Typography>
    ));
  };

  const renderVisualization = useCallback((visualization: VisualizationData) => {
    const { chart_type, title, description, data } = visualization;

    const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

    const formatLabel = (entry: any) => {
      const category = entry.category || entry.name || 'Unknown';
      const value = entry.value || 0;
      return `${category}: ${value}`;
    };

    const ChartComponent = () => {
      switch (chart_type) {
        case 'bar':
          return (
            <ResponsiveContainer width="100%" height={300} >
              <BarChart data={data}>
                <XAxis dataKey="category" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="value" fill="#8884d8" name="Value" />
              </BarChart>
            </ResponsiveContainer>
          );
        case 'pie':
          return (
            <ResponsiveContainer width="100%" height={400}>
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  outerRadius={150}
                  fill="#8884d8"
                  label={formatLabel}
                  labelLine={true}
                >
                  {data.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value, name, props) => {
                  const total = data.reduce((sum: number, item: any) => sum + (item.value || 0), 0);
                  const percentage = ((props.payload.value / total) * 100).toFixed(2);
                  return [`${value} (${percentage}%)`, props.payload.category || 'Unknown'];
                }} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          );
        case 'line':
          return (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data}>
                <XAxis dataKey="category" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="value" stroke="#8884d8" name="Value" />
              </LineChart>
            </ResponsiveContainer>
          );
        case 'radar':
          return (
            <ResponsiveContainer width="100%" height={300}>
              <RadarChart cx="50%" cy="50%" outerRadius="80%" data={data}>
                <PolarGrid />
                <PolarAngleAxis dataKey="category" />
                <PolarRadiusAxis />
                <Radar name="Value" dataKey="value" stroke="#8884d8" fill="#8884d8" fillOpacity={0.6} />
              </RadarChart>
            </ResponsiveContainer>
          );
        default:
          return <p>Unsupported chart type: {chart_type}</p>;
      }
    };

    return (
      <Box sx={{ mt: 2, p: 2, border: '1px solid #ccc', borderRadius: 2 }}>
        <Typography variant="h5" gutterBottom>{title || 'Visualization'}</Typography>
        <Typography variant="body1" paragraph>{description || 'No description available.'}</Typography>
        {data && data.length > 0 ? (
          <ChartComponent />
        ) : (
          <Typography variant="body1">No data available for visualization.</Typography>
        )}
      </Box>
    );
  }, []);

  const MemoizedVisualization = React.memo(({ visualization }: { visualization: VisualizationData }) => 
    renderVisualization(visualization)
  );

  const toggleLinks = (index: number) => {
    setExpandedLinks(expandedLinks === index ? null : index);
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Container maxWidth="md">
        <Box sx={{ maxheight: '100vh', display: 'flex', flexDirection: 'column', py: 2, mt: 10 }}>
          <Paper elevation={3} sx={{ flexGrow: 1, mb: 2, overflow: 'auto', p: 2, display: 'flex', flexDirection: 'column' }}>
            <List sx={{ flexGrow: 1 }}>
              {messages.map((message, index) => (
                <ListItem key={index} sx={{ flexDirection: 'column', alignItems: message.isUser ? 'flex-end' : 'flex-start' }}>
                  <Paper 
                    elevation={1} 
                    sx={{ 
                      p: 2, 
                      maxWidth: '70%', 
                      bgcolor: message.isUser ? '#e6f2ff' : '#fff0f5',
                      color: message.isUser ? '#333' : '#333',
                      borderRadius: '12px',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                    }}
                  >
                    {renderMessageText(message.text)}
                    {message.visualization && <MemoizedVisualization visualization={message.visualization} />}
                    {message.sources && (
                      <Box sx={{ mt: 2 }}>
                        <Button
                          startIcon={<LinkIcon />}
                          onClick={() => toggleLinks(index)}
                          size="small"
                          sx={{ 
                            textTransform: 'none',
                            color: '#666',
                            '&:hover': {
                              backgroundColor: 'rgba(0, 0, 0, 0.04)',
                            },
                          }}
                        >
                          {expandedLinks === index ? 'Hide' : 'Show'} helpful links
                        </Button>
                        <Collapse in={expandedLinks === index}>
                          <List dense>
                            {message.sources.map((source, idx) => (
                              <ListItem key={idx} disablePadding>
                                <Link 
                                  href={source} 
                                  target="_blank" 
                                  rel="noopener noreferrer" 
                                  sx={{ 
                                    color: '#1976d2',
                                    fontSize: '0.875rem',
                                    '&:hover': {
                                      textDecoration: 'underline',
                                    },
                                  }}
                                >
                                  {source}
                                </Link>
                              </ListItem>
                            ))}
                          </List>
                        </Collapse>
                      </Box>
                    )}
                  </Paper>
                </ListItem>
              ))}
            </List>
            <div ref={messagesEndRef} />
            {suggestedQuestions.length > 0 && (
              <Box sx={{ mt: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {suggestedQuestions.map((question, index) => (
                  <Chip
                    key={index}
                    label={question}
                    onClick={() => handleSuggestedQuestionClick(question)}
                    color="primary"
                    variant="outlined"
                    sx={{ cursor: 'pointer' }}
                  />
                ))}
              </Box>
            )}
          </Paper>
          <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', alignItems: 'center', mt: 2 }}>
            <TextField
              fullWidth
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a question!"
              disabled={isLoading}
              InputProps={{
                startAdornment: (
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <input
                      accept=".pdf,.html,.docx,.doc,.md,.txt"
                      style={{ display: 'none' }}
                      id="file-upload"
                      type="file"
                      onChange={handleFileUpload}
                    />
                    <label htmlFor="file-upload">
                      <Button
                        component="span"
                        disabled={isLoading}
                        sx={{ minWidth: 'auto', p: '6px' }}
                      >
                        <AttachFileIcon />
                      </Button>
                    </label>
                  </Box>
                ),
                endAdornment: (
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Button
                      type="submit"
                      disabled={isLoading}
                      sx={{ minWidth: 'auto', p: '6px' }}
                    >
                      <SendIcon />
                    </Button>
                  </Box>
                ),
              }}
              
            />
          </Box>
          {uploadedDocument && (
            <Typography variant="caption" sx={{ mt: 1 }}>
              Uploaded: {uploadedDocument.name}
            </Typography>
          )}
        </Box>
        <Accordion sx={{ mt: 2 }}>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon />}
              aria-controls="prompt-modifier-content"
              id="prompt-modifier-header"
            >
              <Typography>Settings</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <TextField
                fullWidth
                multiline
                rows={2}
                margin="normal"
                label="Prompt Modifier"
                variant="outlined"
                value={promptModifier}
                onChange={(e) => setPromptModifier(e.target.value)}
              />
            </AccordionDetails>
          </Accordion>
      </Container>
    </ThemeProvider>
  );
};

export default ChatBot;