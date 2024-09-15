import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Typography, Box, Card, CardContent, CardHeader, Button, Avatar, Grid, Skeleton } from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faComment, faHeart, faRetweet } from '@fortawesome/free-solid-svg-icons';
import ReactMarkdown from 'react-markdown';

interface IdeaDetailsProps {
  backendUrl: string;
  customerName: string;
}

interface IdeaItem {
  title: string;
  description: string;
  icon: string;
  image: string | null;
}

const IdeaDetails: React.FC<IdeaDetailsProps> = ({ backendUrl, customerName }) => {
  const { ideatorName, ideaTitle } = useParams<{ ideatorName: string; ideaTitle: string }>();
  const [ideaItem, setIdeaItem] = useState<IdeaItem | null>(null);
  const [pressRelease, setPressRelease] = useState('');
  const [socialMediaPost, setSocialMediaPost] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const fetchedRef = useRef(false);
  // Format the customer name for the social media handle
  const socialMediaHandle = customerName.toLowerCase().replace(/\s+/g, '');

  useEffect(() => {
    const fetchIdeaItem = async () => {
      if (!ideatorName || !ideaTitle) {
        throw new Error('Ideator name and idea title are required');
      }
      
      try {
        const response = await fetch(`${backendUrl}/idea-item/${ideatorName.replace(/\s+/g, '-')}/${encodeURIComponent(ideaTitle)}`);
        if (!response.ok) {
          throw new Error('Failed to fetch idea item');
        }

        const data = await response.json();
        setIdeaItem(data);
      } catch (error) {
        console.error('Error fetching idea item:', error);
        setError(error instanceof Error ? error.message : 'An error occurred');
      }
    };

    fetchIdeaItem();
  }, [backendUrl, ideatorName, ideaTitle]);

  useEffect(() => {
    const fetchDetails = async () => {
      if (!ideatorName || !ideaTitle) {
        throw new Error('Ideator name and idea title are required');
      }
      if (fetchedRef.current || !ideaItem) return;
      fetchedRef.current = true;
      try {
        const response = await fetch(`${backendUrl}/idea-details`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: ideaItem.title,
            item_type: ideatorName.replace(/\s+/g, '-'),
            description: ideaItem.description,
          }),
        });

        if (!response.ok) {
          throw new Error('Network response was not ok');
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (reader) {
          let pressReleaseBuffer = '';
          let socialMediaBuffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n\n');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  switch (data.type) {
                    case 'press_release':
                      pressReleaseBuffer += data.content;
                      setPressRelease(pressReleaseBuffer);
                      break;
                    case 'social_media':
                      socialMediaBuffer += data.content;
                      setSocialMediaPost(socialMediaBuffer);
                      break;
                    case 'error':
                      throw new Error(data.error);
                  }
                } catch (error) {
                  console.error('Error parsing SSE data:', error);
                }
              }
            }
          }
        }
      } catch (error) {
        console.error('Error fetching idea details:', error);
        setError(error instanceof Error ? error.message : 'An error occurred');
      }
    };

    fetchDetails();
  }, [backendUrl, ideatorName, ideaItem]);

  if (error) {
    return <Typography color="error">{error}</Typography>;
  }

  if (!ideaItem) {
    return <Typography>Loading idea details...</Typography>;
  }

  return (
    <Box sx={{ mt: 4, maxWidth: 1200, mx: 'auto' }}>
      <Button onClick={() => navigate(-1)} sx={{ mb: 2 }}>
        <FontAwesomeIcon icon={faArrowLeft} style={{ marginRight: '8px' }} />
        Back to Ideas
      </Button>
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardHeader title="Press Release" />
            <CardContent>
              {pressRelease ? (
                <ReactMarkdown>{pressRelease}</ReactMarkdown>
              ) : (
                <Typography variant="body1">Generating press release...</Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardHeader title="Sample Social Media Post" />
            <CardContent>
              <Box sx={{
                border: '1px solid #e1e8ed',
                borderRadius: '12px',
                padding: 2,
                backgroundColor: '#ffffff',
                boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <Avatar sx={{ bgcolor: '#1DA1F2', width: 48, height: 48, mr: 2 }}>
                    {customerName.charAt(0).toUpperCase()}
                  </Avatar>
                  <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold', color: '#14171a' }}>
                      {customerName}
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#657786' }}>
                      @{socialMediaHandle}
                    </Typography>
                  </Box>
                </Box>
                {socialMediaPost ? (
                  <>
                  <ReactMarkdown>{socialMediaPost}</ReactMarkdown>
                  {ideaItem.image && (
                    <Box sx={{ mt: 2, mb: 2 }}>
                      <img src={`data:image/jpeg;base64,${ideaItem.image}`} alt="Idea visualization" style={{ width: '100%', borderRadius: '12px' }} />
                    </Box>
                  )}
                  </>
                ) : (
                  <Skeleton variant="text" width="80%" />
                )}

                <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 2, color: '#657786' }}>
                  <Typography variant="caption">Just now</Typography>
                  <Box>
                    <FontAwesomeIcon icon={faComment} style={{ marginRight: '16px' }} />
                    <FontAwesomeIcon icon={faRetweet} style={{ marginRight: '16px' }} />
                    <FontAwesomeIcon icon={faHeart} />
                  </Box>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default IdeaDetails;