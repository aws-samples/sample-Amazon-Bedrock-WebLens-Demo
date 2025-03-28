import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Typography, Box, Card, CardContent, CardHeader, Button, Avatar, Grid, Skeleton, Rating } from '@mui/material';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faComment, faHeart, faRetweet } from '@fortawesome/free-solid-svg-icons';
import ReactMarkdown from 'react-markdown';
import { faNewspaper } from '@fortawesome/free-solid-svg-icons';
import { faShareAlt } from '@fortawesome/free-solid-svg-icons';
import { faUserCircle } from '@fortawesome/free-solid-svg-icons';


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

interface CustomerReview {
  name: string;
  rating: number;
  comment: string;
  verified?: boolean;
  topReviewer?: boolean;
}

const IdeaDetails: React.FC<IdeaDetailsProps> = ({ backendUrl, customerName }) => {
  const { ideatorName, ideaTitle } = useParams<{ ideatorName: string; ideaTitle: string }>();
  const [ideaItem, setIdeaItem] = useState<IdeaItem | null>(null);
  const [pressRelease, setPressRelease] = useState('');
  const [customerReviews, setCustomerReviews] = useState<CustomerReview[]>([]);
  const [socialMediaPost, setSocialMediaPost] = useState('');
  const [loadingPressRelease, setLoadingPressRelease] = useState<boolean>(true);
  const [loadingSocialMedia, setLoadingSocialMedia] = useState<boolean>(true);
  const [loadingReviews, setLoadingReviews] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const fetchedRef = useRef(false);
  const socialMediaHandle = customerName.toLowerCase().replace(/\s+/g, '');

  useEffect(() => {
    const fetchIdeaItem = async () => {
      if (!ideatorName || !ideaTitle) {
        setError('Ideator name and idea title are required');
        return;
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
        setError('Ideator name and idea title are required');
        return;
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
                    case 'press_release_start':
                      setLoadingPressRelease(true);
                      break;
                    case 'press_release':
                      pressReleaseBuffer += data.content;
                      setPressRelease(pressReleaseBuffer);
                      break;
                    case 'press_release_end':
                      setLoadingPressRelease(false);
                      break;
                    case 'social_media_start':
                      setLoadingSocialMedia(true);
                      break;
                    case 'social_media':
                      socialMediaBuffer += data.content;
                      setSocialMediaPost(socialMediaBuffer);
                      break;
                    case 'social_media_end':
                      setLoadingSocialMedia(false);
                      break;
                    case 'customer_reviews_start':
                      setLoadingReviews(true);
                      break;
                    case 'customer_reviews':
                      setCustomerReviews(data.content);
                      break;
                    case 'customer_reviews_end':
                      setLoadingReviews(false);
                      break;
                    case 'error':
                      throw new Error(data.error);
                    case 'stop':
                      // Optionally handle stop event
                      break;
                    default:
                      console.warn(`Unknown event type: ${data.type}`);
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
    <Box sx={{ mt: 4, mb: 15, maxWidth: 1200, mx: 'auto' }}>
      <Button onClick={() => navigate(-1)} sx={{ mb: 2 }}>
        <FontAwesomeIcon icon={faArrowLeft} style={{ marginRight: '8px' }} />
        Back to Ideas
      </Button>
      <Grid container spacing={3}>
        {/* Press Release Section */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardHeader title={<Box sx={{ display: 'flex', alignItems: 'center' }}>
              <FontAwesomeIcon icon={faNewspaper} style={{ marginRight: '8px' }} />
              Press Release
            </Box>} />
            <CardContent>
              {loadingPressRelease ? (
                <Skeleton variant="text" height={200} />
              ) : pressRelease ? (
                <ReactMarkdown>{pressRelease}</ReactMarkdown>
              ) : (
                <Typography variant="body1">Press release is unavailable.</Typography>
              )}
            </CardContent>
          </Card>
        </Grid>

        {/* Social Media Post Section */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: '100%' }}>
            <CardHeader title={<Box sx={{ display: 'flex', alignItems: 'center' }}>
              <FontAwesomeIcon icon={faShareAlt} style={{ marginRight: '8px' }} />
              Sample Social Media Post
            </Box>} />
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
                {loadingSocialMedia ? (
                  <Skeleton variant="text" width="80%" />
                ) : socialMediaPost ? (
                  <>
                    <ReactMarkdown>{socialMediaPost}</ReactMarkdown>
                    {ideaItem.image && (
                      <Box sx={{ mt: 2, mb: 2 }}>
                        <img src={`data:image/jpeg;base64,${ideaItem.image}`} alt="Idea visualization" style={{ width: '100%', borderRadius: '12px' }} />
                      </Box>
                    )}
                  </>
                ) : (
                  <Typography variant="body1">Social media post is unavailable.</Typography>
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

        {/* Customer Review Preview Section */}
        <Grid item xs={12}>
          <Card>
            <CardHeader title={<Box sx={{ display: 'flex', alignItems: 'center' }}>
              <FontAwesomeIcon icon={faUserCircle} style={{ marginRight: '8px' }} />
              Customer Review Preview
            </Box>} />
            <CardContent>
              {loadingReviews ? (
                <Box>
                  <Skeleton variant="text" width="80%" />
                  <Skeleton variant="text" width="60%" />
                  <Skeleton variant="text" width="70%" />
                </Box>
              ) : customerReviews.length > 0 ? (
                customerReviews.map((review, index) => (
                  <Box key={index} sx={{ mb: 2, pb: 2, borderBottom: index < customerReviews.length - 1 ? '1px solid #e0e0e0' : 'none' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                      <Avatar sx={{ mr: 2 }}>{review.name.charAt(0)}</Avatar>
                      <Typography variant="subtitle1">{review.name}</Typography>
                      {review.verified && (
                        <Typography variant="caption" sx={{ ml: 1, bgcolor: 'primary.main', color: 'white', px: 1, borderRadius: 1 }}>
                          Verified Purchase
                        </Typography>
                      )}
                      {review.topReviewer && (
                        <Typography variant="caption" sx={{ ml: 1, bgcolor: 'secondary.main', color: 'white', px: 1, borderRadius: 1 }}>
                          Top Reviewer
                        </Typography>
                      )}
                    </Box>
                    <Rating value={review.rating} readOnly />
                    <Typography variant="body1">{review.comment}</Typography>
                  </Box>
                ))
              ) : (
                <Typography variant="body1">No customer reviews available.</Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default IdeaDetails;