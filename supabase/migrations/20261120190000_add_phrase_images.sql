alter table phrases
  add column image_url text check (image_url is null or (length(image_url) <= 4096 and image_url ~ '^https://'));

alter table flashcard_settings
  add column image_max_width integer not null default 240 check (image_max_width between 120 and 480),
  add column image_max_height integer not null default 180 check (image_max_height between 90 and 360);
