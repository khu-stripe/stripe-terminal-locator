-- Run this in Supabase Dashboard → SQL Editor → New Query → paste and Run

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users profile table
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  nickname TEXT,
  display_name TEXT,
  photo_url TEXT,
  locations_created INTEGER DEFAULT 0,
  referral_count INTEGER DEFAULT 0,
  referral_code TEXT UNIQUE,
  referred_by UUID REFERENCES public.users(id),
  referred_by_code TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Locations table
CREATE TABLE public.locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  description TEXT DEFAULT '',
  contact TEXT DEFAULT '',
  created_by UUID REFERENCES public.users(id),
  created_by_nickname TEXT,
  created_by_email TEXT,
  upvotes INTEGER DEFAULT 0,
  downvotes INTEGER DEFAULT 0,
  photos JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- Votes table (one per user per location)
CREATE TABLE public.votes (
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  vote_type TEXT NOT NULL CHECK (vote_type IN ('up', 'down')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (location_id, user_id)
);

-- Indexes
CREATE INDEX idx_locations_created_at ON public.locations(created_at DESC);
CREATE INDEX idx_locations_created_by ON public.locations(created_by);
CREATE INDEX idx_votes_location_id ON public.votes(location_id);
CREATE INDEX idx_users_referral_code ON public.users(referral_code);
CREATE INDEX idx_users_locations_created ON public.users(locations_created DESC);

-- Auto-create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, display_name, photo_url, created_at)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url',
    NOW()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Row Level Security
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;

-- Users policies
CREATE POLICY "Public read users" ON public.users FOR SELECT USING (true);
CREATE POLICY "Own insert users" ON public.users FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Own update users" ON public.users FOR UPDATE USING (auth.uid() = id);

-- Locations policies
CREATE POLICY "Public read locations" ON public.locations FOR SELECT USING (true);
CREATE POLICY "Auth insert locations" ON public.locations FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Own update locations" ON public.locations FOR UPDATE USING (auth.uid() = created_by);
CREATE POLICY "Own delete locations" ON public.locations FOR DELETE USING (auth.uid() = created_by);

-- Votes policies
CREATE POLICY "Public read votes" ON public.votes FOR SELECT USING (true);
CREATE POLICY "Auth insert votes" ON public.votes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own update votes" ON public.votes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Own delete votes" ON public.votes FOR DELETE USING (auth.uid() = user_id);

-- Storage bucket for photos
INSERT INTO storage.buckets (id, name, public) VALUES ('location-photos', 'location-photos', true);

-- Storage policies
CREATE POLICY "Public read photos" ON storage.objects FOR SELECT USING (bucket_id = 'location-photos');
CREATE POLICY "Auth upload photos" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'location-photos' AND auth.uid() IS NOT NULL);
CREATE POLICY "Auth delete photos" ON storage.objects FOR DELETE USING (bucket_id = 'location-photos' AND auth.uid() IS NOT NULL);
