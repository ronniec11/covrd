-- ============================================
-- CleanTrack — Supabase Schema Setup
-- Run this in your Supabase SQL editor
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- PROFILES (extends auth.users)
-- ============================================
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  role        TEXT NOT NULL DEFAULT 'foreman' CHECK (role IN ('admin', 'pm', 'foreman')),
  color       TEXT NOT NULL DEFAULT '#4ade80',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_all"   ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_insert_own"   ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own"   ON profiles FOR UPDATE USING (auth.uid() = id);

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, role, color)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'foreman'),
    COALESCE(NEW.raw_user_meta_data->>'color', '#4ade80')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================
-- PROJECTS
-- ============================================
CREATE TABLE IF NOT EXISTS projects (
  id               UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name             TEXT NOT NULL,
  address          TEXT,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  daily_sf_target  NUMERIC DEFAULT 0,
  created_by       UUID REFERENCES auth.users,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- Members can see projects they belong to
CREATE POLICY "projects_select_members" ON projects FOR SELECT USING (
  id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid())
);

-- Admin/PM can create
CREATE POLICY "projects_insert_pm" ON projects FOR INSERT WITH CHECK (
  (SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'pm')
);

-- Admin/PM can update
CREATE POLICY "projects_update_pm" ON projects FOR UPDATE USING (
  (SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'pm')
);

-- ============================================
-- PROJECT MEMBERS
-- ============================================
CREATE TABLE IF NOT EXISTS project_members (
  id          UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  project_id  UUID REFERENCES projects ON DELETE CASCADE NOT NULL,
  user_id     UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (project_id, user_id)
);

ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;

-- Members can view other members of their projects
CREATE POLICY "members_select" ON project_members FOR SELECT USING (
  project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid())
);

-- Admin/PM can add members
CREATE POLICY "members_insert_pm" ON project_members FOR INSERT WITH CHECK (
  (SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'pm')
);

-- Admin/PM can remove members
CREATE POLICY "members_delete_pm" ON project_members FOR DELETE USING (
  (SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'pm')
);

-- ============================================
-- PAGES (floor plan pages)
-- ============================================
CREATE TABLE IF NOT EXISTS pages (
  id                    UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  project_id            UUID REFERENCES projects ON DELETE CASCADE NOT NULL,
  name                  TEXT NOT NULL,
  floor_plan_url        TEXT,
  scale_pixels_per_foot NUMERIC,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE pages ENABLE ROW LEVEL SECURITY;

-- Members of the project can view pages
CREATE POLICY "pages_select_members" ON pages FOR SELECT USING (
  project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid())
);

-- Admin/PM can create pages
CREATE POLICY "pages_insert_pm" ON pages FOR INSERT WITH CHECK (
  (SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'pm')
);

-- Admin/PM can update pages
CREATE POLICY "pages_update_pm" ON pages FOR UPDATE USING (
  (SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'pm')
);

-- ============================================
-- SESSIONS (canvas drawing sessions)
-- ============================================
CREATE TABLE IF NOT EXISTS sessions (
  id             UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  page_id        UUID REFERENCES pages ON DELETE CASCADE NOT NULL,
  user_id        UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  strokes        JSONB DEFAULT '[]',
  sf_calculated  NUMERIC DEFAULT 0,
  date           DATE DEFAULT CURRENT_DATE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (page_id, user_id, date)
);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Any member of the project can view sessions for its pages
CREATE POLICY "sessions_select_members" ON sessions FOR SELECT USING (
  page_id IN (
    SELECT p.id FROM pages p
    JOIN project_members pm ON pm.project_id = p.project_id
    WHERE pm.user_id = auth.uid()
  )
);

-- Users can insert their own sessions
CREATE POLICY "sessions_insert_own" ON sessions FOR INSERT WITH CHECK (
  auth.uid() = user_id
);

-- Users can update their own sessions
CREATE POLICY "sessions_update_own" ON sessions FOR UPDATE USING (
  auth.uid() = user_id
);

-- Enable realtime on sessions table
ALTER PUBLICATION supabase_realtime ADD TABLE sessions;

-- ============================================
-- STORAGE — floor-plans bucket
-- ============================================

-- Create the floor-plans bucket (run separately if needed)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'floor-plans',
  'floor-plans',
  true,
  20971520,  -- 20 MB
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "floor_plans_select_public" ON storage.objects
  FOR SELECT USING (bucket_id = 'floor-plans');

CREATE POLICY "floor_plans_insert_pm" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'floor-plans' AND
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  );

CREATE POLICY "floor_plans_update_pm" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'floor-plans' AND
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  );

CREATE POLICY "floor_plans_delete_pm" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'floor-plans' AND
    (SELECT role FROM public.profiles WHERE id = auth.uid()) IN ('admin', 'pm')
  );

-- ============================================
-- SAMPLE DATA (optional — remove in prod)
-- ============================================
-- After running schema, create your first user via Supabase Auth
-- then run:
--
-- UPDATE profiles SET role = 'admin' WHERE email = 'your@email.com';
--
-- This promotes your first account to admin so you can manage the rest.
