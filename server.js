const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs').promises;
const path = require('path');
const { initializeSupabase, getSupabase } = require('./supabase-config');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

// Initialize Supabase
let useSupabase = false;
const supabase = initializeSupabase();
if (supabase) {
  useSupabase = true;
  console.log('Using Supabase as database');
} else {
  console.log('Using local JSON file as database');
}

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static('public'));

// Auth middleware — verifies Supabase JWT token
async function requireAuth(req, res, next) {
  if (!useSupabase) return next();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = user;
  next();
}

// Helper function to read data (Supabase or local)
async function readData() {
  if (useSupabase) {
    try {
      const { data, error } = await supabase
        .from('locations')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const locations = (data || []).map(mapLocationFromDB);
      return { locations };
    } catch (error) {
      console.error('Error reading from Supabase:', error);
      return await readDataFromFile();
    }
  } else {
    return await readDataFromFile();
  }
}

// Map DB row (snake_case) to API response (camelCase)
function mapLocationFromDB(row) {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    description: row.description,
    contact: row.contact,
    createdBy: row.created_by,
    createdByNickname: row.created_by_nickname,
    createdByEmail: row.created_by_email,
    upvotes: row.upvotes,
    downvotes: row.downvotes,
    photos: row.photos || [],
    countryCode: row.country_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// Helper function to read from local JSON file
async function readDataFromFile() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return { locations: [] };
  }
}

// Helper function to write data (local fallback only)
async function writeData(data) {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

// Helper function to generate referral code
function generateReferralCode(length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Helper function to ensure unique referral code
async function generateUniqueReferralCode() {
  if (!useSupabase) return generateReferralCode();

  let attempts = 0;
  let code;

  do {
    code = generateReferralCode();
    attempts++;

    const { data } = await supabase
      .from('users')
      .select('id')
      .eq('referral_code', code)
      .limit(1);

    if (!data || data.length === 0) return code;
  } while (attempts < 10);

  return generateReferralCode(6) + Date.now().toString().slice(-2);
}

// Helper function to process referral
async function processReferral(newUserId, referralCode) {
  if (!useSupabase || !referralCode) return null;

  try {
    const { data: referrerData, error } = await supabase
      .from('users')
      .select('*')
      .eq('referral_code', referralCode.toUpperCase())
      .limit(1)
      .single();

    if (error || !referrerData) {
      console.log('Referral code not found:', referralCode);
      return null;
    }

    if (referrerData.id === newUserId) {
      console.log('Self-referral attempted');
      return null;
    }

    // Update the new user to mark them as referred
    await supabase
      .from('users')
      .update({
        referred_by: referrerData.id,
        referred_by_code: referralCode.toUpperCase()
      })
      .eq('id', newUserId);

    // Increment referrer's referral count
    await supabase
      .from('users')
      .update({ referral_count: (referrerData.referral_count || 0) + 1 })
      .eq('id', referrerData.id);

    console.log(`Referral processed: ${referrerData.nickname} referred new user`);
    return {
      referrerId: referrerData.id,
      referrerNickname: referrerData.nickname
    };
  } catch (error) {
    console.error('Error processing referral:', error);
    return null;
  }
}

// API Routes

// GET client config (public-safe values only)
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ''
  });
});

// GET locations (optionally filtered by country)
app.get('/api/locations', async (req, res) => {
  try {
    const country = req.query.country ? req.query.country.toUpperCase() : null;

    if (useSupabase) {
      let query = supabase.from('locations').select('*').order('created_at', { ascending: false });
      if (country) query = query.eq('country_code', country);
      const { data, error } = await query;
      if (error) throw error;
      return res.json((data || []).map(mapLocationFromDB));
    }

    const data = await readData();
    let locations = data.locations;
    if (country) locations = locations.filter(l => (l.countryCode || 'SG').toUpperCase() === country);
    res.json(locations);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
});

// POST new location
app.post('/api/locations', requireAuth, async (req, res) => {
  try {
    const {
      name, address, latitude, longitude, description, contact,
      createdBy, createdByNickname, createdByEmail, countryCode
    } = req.body;

    if (!name || !address || !latitude || !longitude) {
      return res.status(400).json({ error: 'Name, address, latitude, and longitude are required' });
    }

    let newLocation;

    if (useSupabase) {
      const { data, error } = await supabase
        .from('locations')
        .insert({
          name,
          address,
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
          description: description || '',
          contact: contact || '',
          created_by: createdBy || null,
          created_by_nickname: createdByNickname || null,
          created_by_email: createdByEmail || null,
          country_code: (countryCode || 'SG').toUpperCase()
        })
        .select()
        .single();

      if (error) throw error;

      // Increment user's location count
      if (createdBy) {
        const { data: user } = await supabase
          .from('users')
          .select('locations_created')
          .eq('id', createdBy)
          .single();

        if (user) {
          await supabase
            .from('users')
            .update({ locations_created: (user.locations_created || 0) + 1 })
            .eq('id', createdBy);
        }
      }

      newLocation = mapLocationFromDB(data);
    } else {
      const fileData = await readData();
      newLocation = {
        id: Date.now().toString(),
        name,
        address,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        description: description || '',
        contact: contact || '',
        createdBy: createdBy || null,
        createdByNickname: createdByNickname || null,
        createdByEmail: createdByEmail || null,
        upvotes: 0,
        downvotes: 0,
        photos: [],
        createdAt: new Date().toISOString()
      };
      fileData.locations.push(newLocation);
      await writeData(fileData);
    }

    res.status(201).json(newLocation);
  } catch (error) {
    console.error('Error adding location:', error);
    res.status(500).json({ error: 'Failed to add location' });
  }
});

// PUT update location
app.put('/api/locations/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, address, latitude, longitude, description, userId, photosToRemove } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required for updating' });
    }
    if (!name || !address || !latitude || !longitude) {
      return res.status(400).json({ error: 'Name, address, latitude, and longitude are required' });
    }

    if (useSupabase) {
      // Verify ownership
      const { data: existing, error: fetchError } = await supabase
        .from('locations')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError || !existing) {
        return res.status(404).json({ error: 'Location not found' });
      }
      if (existing.created_by !== userId) {
        return res.status(403).json({ error: 'You can only edit locations you created' });
      }

      const updateData = {
        name,
        address,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        description: description || '',
        updated_at: new Date().toISOString()
      };

      // Handle photo removal
      if (photosToRemove && Array.isArray(photosToRemove) && photosToRemove.length > 0) {
        const currentPhotos = existing.photos || [];
        updateData.photos = currentPhotos.filter(photo => {
          const photoStr = typeof photo === 'string' ? photo : JSON.stringify(photo);
          return !photosToRemove.some(removePhoto => {
            const removePhotoStr = typeof removePhoto === 'string' ? removePhoto : JSON.stringify(removePhoto);
            return photoStr === removePhotoStr;
          });
        });

        // Delete photos from Supabase Storage
        for (const photo of photosToRemove) {
          try {
            if (typeof photo === 'string') {
              const filePath = extractStoragePath(photo);
              if (filePath) {
                await supabase.storage.from('location-photos').remove([filePath]);
              }
            } else {
              if (photo.full) {
                const fullPath = extractStoragePath(photo.full);
                if (fullPath) await supabase.storage.from('location-photos').remove([fullPath]);
              }
              if (photo.thumb) {
                const thumbPath = extractStoragePath(photo.thumb);
                if (thumbPath) await supabase.storage.from('location-photos').remove([thumbPath]);
              }
            }
          } catch (deleteError) {
            console.error('Error deleting photo from storage:', deleteError);
          }
        }
      }

      const { data: updated, error: updateError } = await supabase
        .from('locations')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (updateError) throw updateError;

      res.json(mapLocationFromDB(updated));
    } else {
      const data = await readData();
      const index = data.locations.findIndex(loc => loc.id === id);
      if (index === -1) return res.status(404).json({ error: 'Location not found' });

      data.locations[index] = {
        ...data.locations[index],
        name,
        address,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        description: description || '',
        updatedAt: new Date().toISOString()
      };

      if (photosToRemove && Array.isArray(photosToRemove) && photosToRemove.length > 0) {
        const currentPhotos = data.locations[index].photos || [];
        data.locations[index].photos = currentPhotos.filter(photo => !photosToRemove.includes(photo));
      }

      await writeData(data);
      res.json(data.locations[index]);
    }
  } catch (error) {
    console.error('Error updating location:', error);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

// DELETE location
app.delete('/api/locations/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    if (useSupabase) {
      if (!userId) {
        return res.status(400).json({ error: 'User ID is required for deletion' });
      }

      const { data: existing, error: fetchError } = await supabase
        .from('locations')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError || !existing) {
        return res.status(404).json({ error: 'Location not found' });
      }
      if (existing.created_by !== userId) {
        return res.status(403).json({ error: 'You can only delete locations you created' });
      }

      // Delete photos from storage
      const photos = existing.photos || [];
      for (const photo of photos) {
        try {
          if (typeof photo === 'string') {
            const filePath = extractStoragePath(photo);
            if (filePath) await supabase.storage.from('location-photos').remove([filePath]);
          } else {
            if (photo.full) {
              const fullPath = extractStoragePath(photo.full);
              if (fullPath) await supabase.storage.from('location-photos').remove([fullPath]);
            }
            if (photo.thumb) {
              const thumbPath = extractStoragePath(photo.thumb);
              if (thumbPath) await supabase.storage.from('location-photos').remove([thumbPath]);
            }
          }
        } catch (deleteError) {
          console.error('Error deleting photo:', deleteError);
        }
      }

      // Delete location (votes cascade automatically)
      const { error: deleteError } = await supabase
        .from('locations')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;

      // Decrement user's location count
      if (existing.created_by) {
        const { data: user } = await supabase
          .from('users')
          .select('locations_created')
          .eq('id', existing.created_by)
          .single();

        if (user) {
          await supabase
            .from('users')
            .update({ locations_created: Math.max(0, (user.locations_created || 1) - 1) })
            .eq('id', existing.created_by);
        }
      }
    } else {
      const data = await readData();
      const index = data.locations.findIndex(loc => loc.id === id);
      if (index === -1) return res.status(404).json({ error: 'Location not found' });
      data.locations.splice(index, 1);
      await writeData(data);
    }

    res.json({ message: 'Location deleted successfully' });
  } catch (error) {
    console.error('Error deleting location:', error);
    res.status(500).json({ error: 'Failed to delete location' });
  }
});

// POST vote for location
app.post('/api/locations/:id/vote', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { voteType, userId } = req.body;

    if (!voteType || (voteType !== 'up' && voteType !== 'down')) {
      return res.status(400).json({ error: 'Valid voteType is required (up or down)' });
    }

    let result;

    if (useSupabase) {
      if (!userId) {
        return res.status(400).json({ error: 'User ID is required for voting' });
      }

      // Check location exists
      const { data: location, error: locError } = await supabase
        .from('locations')
        .select('upvotes, downvotes')
        .eq('id', id)
        .single();

      if (locError || !location) {
        return res.status(404).json({ error: 'Location not found' });
      }

      let upvotes = location.upvotes || 0;
      let downvotes = location.downvotes || 0;
      let userVote = null;

      // Check existing vote
      const { data: existingVote } = await supabase
        .from('votes')
        .select('vote_type')
        .eq('location_id', id)
        .eq('user_id', userId)
        .single();

      if (existingVote) {
        if (existingVote.vote_type === voteType) {
          // Same vote — remove it
          await supabase.from('votes').delete().eq('location_id', id).eq('user_id', userId);
          if (voteType === 'up') upvotes = Math.max(0, upvotes - 1);
          else downvotes = Math.max(0, downvotes - 1);
          userVote = null;
        } else {
          // Switch vote
          await supabase.from('votes').update({ vote_type: voteType, created_at: new Date().toISOString() }).eq('location_id', id).eq('user_id', userId);
          if (existingVote.vote_type === 'up') { upvotes = Math.max(0, upvotes - 1); downvotes += 1; }
          else { downvotes = Math.max(0, downvotes - 1); upvotes += 1; }
          userVote = voteType;
        }
      } else {
        // New vote
        await supabase.from('votes').insert({ location_id: id, user_id: userId, vote_type: voteType });
        if (voteType === 'up') upvotes += 1;
        else downvotes += 1;
        userVote = voteType;
      }

      // Update location vote counts
      await supabase.from('locations').update({ upvotes, downvotes }).eq('id', id);

      result = { id, upvotes, downvotes, userVote };
    } else {
      const data = await readData();
      const location = data.locations.find(loc => loc.id === id);
      if (!location) return res.status(404).json({ error: 'Location not found' });

      if (!location.upvotes) location.upvotes = 0;
      if (!location.downvotes) location.downvotes = 0;

      if (voteType === 'up') location.upvotes += 1;
      else location.downvotes += 1;

      await writeData(data);
      result = { id: location.id, upvotes: location.upvotes, downvotes: location.downvotes, userVote: voteType };
    }

    res.json({ ...result, message: 'Vote recorded successfully' });
  } catch (error) {
    console.error('Error recording vote:', error);
    res.status(500).json({ error: 'Failed to record vote' });
  }
});

// GET user's vote for a location
app.get('/api/locations/:id/vote/:userId', async (req, res) => {
  try {
    const { id, userId } = req.params;
    let userVote = null;

    if (useSupabase) {
      const { data } = await supabase
        .from('votes')
        .select('vote_type')
        .eq('location_id', id)
        .eq('user_id', userId)
        .single();

      if (data) userVote = data.vote_type;
    }

    res.json({ userVote });
  } catch (error) {
    console.error('Error getting user vote:', error);
    res.status(500).json({ error: 'Failed to get user vote' });
  }
});

// POST add photos to location
app.post('/api/locations/:id/photos', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { photoURLs } = req.body;

    if (!photoURLs || !Array.isArray(photoURLs) || photoURLs.length === 0) {
      return res.status(400).json({ error: 'Photo URLs are required' });
    }

    if (useSupabase) {
      const { data: location, error: fetchError } = await supabase
        .from('locations')
        .select('photos')
        .eq('id', id)
        .single();

      if (fetchError || !location) {
        return res.status(404).json({ error: 'Location not found' });
      }

      const existingPhotos = location.photos || [];
      const newPhotos = [...existingPhotos, ...photoURLs].slice(0, 10);

      const { error: updateError } = await supabase
        .from('locations')
        .update({ photos: newPhotos })
        .eq('id', id);

      if (updateError) throw updateError;

      res.json({ id, photos: newPhotos, message: 'Photos added successfully' });
    } else {
      const data = await readData();
      const location = data.locations.find(loc => loc.id === id);
      if (!location) return res.status(404).json({ error: 'Location not found' });

      const existingPhotos = location.photos || [];
      location.photos = [...existingPhotos, ...photoURLs].slice(0, 10);
      await writeData(data);

      res.json({ id: location.id, photos: location.photos, message: 'Photos added successfully' });
    }
  } catch (error) {
    console.error('Error adding photos:', error);
    res.status(500).json({ error: 'Failed to add photos' });
  }
});

// GET user's referral code
app.get('/api/users/:id/referral-code', async (req, res) => {
  try {
    const { id } = req.params;

    if (useSupabase) {
      const { data: user, error } = await supabase
        .from('users')
        .select('referral_code, referral_count')
        .eq('id', id)
        .single();

      if (error || !user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (!user.referral_code) {
        const referralCode = await generateUniqueReferralCode();
        await supabase
          .from('users')
          .update({ referral_code: referralCode })
          .eq('id', id);

        return res.json({ referralCode, referralCount: user.referral_count || 0 });
      }

      res.json({ referralCode: user.referral_code, referralCount: user.referral_count || 0 });
    } else {
      res.json({ referralCode: generateReferralCode(), referralCount: 0, message: 'Local mode' });
    }
  } catch (error) {
    console.error('Error getting referral code:', error);
    res.status(500).json({ error: 'Failed to get referral code' });
  }
});

// POST generate new referral code
app.post('/api/users/:id/referral-code', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (useSupabase) {
      const { data: user, error } = await supabase
        .from('users')
        .select('referral_count')
        .eq('id', id)
        .single();

      if (error || !user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const referralCode = await generateUniqueReferralCode();
      await supabase.from('users').update({ referral_code: referralCode }).eq('id', id);

      res.json({ referralCode, referralCount: user.referral_count || 0 });
    } else {
      res.json({ referralCode: generateReferralCode(), referralCount: 0, message: 'Local mode' });
    }
  } catch (error) {
    console.error('Error generating referral code:', error);
    res.status(500).json({ error: 'Failed to generate referral code' });
  }
});

// GET referral leaderboard
app.get('/api/referrals/leaderboard', async (req, res) => {
  try {
    const limitCount = parseInt(req.query.limit) || 10;

    if (useSupabase) {
      const { data, error } = await supabase
        .from('users')
        .select('id, nickname, display_name, email, referral_count, photo_url')
        .gt('referral_count', 0)
        .order('referral_count', { ascending: false })
        .limit(limitCount);

      if (error) throw error;

      const leaderboard = (data || []).map(user => ({
        id: user.id,
        nickname: user.nickname || user.display_name || user.email,
        referralCount: user.referral_count || 0,
        photoURL: user.photo_url || ''
      }));

      res.json(leaderboard);
    } else {
      res.json([]);
    }
  } catch (error) {
    console.error('Error getting referral leaderboard:', error);
    res.status(500).json({ error: 'Failed to get referral leaderboard' });
  }
});

// POST process referral
app.post('/api/users/process-referral', requireAuth, async (req, res) => {
  try {
    const { userId, referralCode } = req.body;

    if (!userId) return res.status(400).json({ error: 'User ID is required' });
    if (!referralCode) return res.json({ message: 'No referral code provided' });

    const result = await processReferral(userId, referralCode);

    if (result) {
      res.json({
        success: true,
        message: `You were referred by ${result.referrerNickname}!`,
        referrerNickname: result.referrerNickname
      });
    } else {
      res.json({ success: false, message: 'Invalid or expired referral code' });
    }
  } catch (error) {
    console.error('Error processing referral:', error);
    res.status(500).json({ error: 'Failed to process referral' });
  }
});

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Helper: extract storage path from Supabase public URL
function extractStoragePath(url) {
  try {
    const urlObj = new URL(url);
    // Supabase public URL format: /storage/v1/object/public/location-photos/path/to/file
    const match = urlObj.pathname.match(/\/storage\/v1\/object\/public\/location-photos\/(.+)/);
    if (match && match[1]) return decodeURIComponent(match[1]);
    // Also handle Firebase URLs during migration period
    const firebaseMatch = urlObj.pathname.match(/\/o\/(.+)/);
    if (firebaseMatch && firebaseMatch[1]) return decodeURIComponent(firebaseMatch[1].split('?')[0]);
    return null;
  } catch (error) {
    return null;
  }
}

// Start server
app.listen(PORT, () => {
  console.log(`Stripe Terminal Locator server running on http://localhost:${PORT}`);
});
