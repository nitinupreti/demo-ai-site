package com.demo.core.models;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;

@ExtendWith(AemContextExtension.class)
class MediaWithCaptionTest {
    private final AemContext context = new AemContext();

    @BeforeEach
    void setUp() { context.addModelsForClasses(MediaWithCaption.class); }

    @Test
    void testVideo() {
        Resource resource = context.create().resource("/content/media", "mediaType", "video", "mediaPath", "/content/dam/demo.mp4", "altText", "Demo");
        MediaWithCaption media = resource.adaptTo(MediaWithCaption.class);
        assertNotNull(media);
        assertTrue(media.isVideo());
        assertTrue(media.isHasContent());
        assertEquals("Demo", media.getAltText());
    }

    @Test
    void testEmptyDefaultsToImage() {
        MediaWithCaption media = context.create().resource("/content/media").adaptTo(MediaWithCaption.class);
        assertNotNull(media);
        assertEquals("image", media.getMediaType());
        assertFalse(media.isVideo());
        assertFalse(media.isHasContent());
    }
}