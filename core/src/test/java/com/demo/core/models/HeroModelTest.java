/*
 * Copyright 2026 Demo AI Site
 */
package com.demo.core.models;

import com.demo.core.testcontext.AppAemContext;
import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;
import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@ExtendWith(AemContextExtension.class)
class HeroModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource r = context.create().resource("/content/test/hero",
                "sling:resourceType", "demo-ai-site/components/hero");
        HeroModel m = r.adaptTo(HeroModel.class);
        assertNotNull(m);
        assertNull(m.getHeading());
        assertNull(m.getVideoSrc());
        assertEquals("au", m.getStyle());
        assertEquals("left", m.getAlign());
        assertFalse(m.isHasContent());
    }

    @Test
    void configuredFully() {
        Map<String, Object> props = new HashMap<>();
        props.put("sling:resourceType", "demo-ai-site/components/hero");
        props.put("heading", "Start your journey at AU");
        props.put("ctaLabel", "Join Us");
        props.put("ctaLink", "/content/demo-ai-site/us/en/admissions");
        props.put("wordmark", "/content/dam/demo-ai-site/design/wordmark.png");
        props.put("videoSrc", "/content/dam/demo-ai-site/design/hero.mp4");
        props.put("fallbackImage", "/content/dam/demo-ai-site/design/hero-fallback.jpg");
        props.put("videoDescription", "AU spirit captured through people and places.");
        props.put("style", "au");
        props.put("align", "center");

        Resource r = context.create().resource("/content/test/hero", props);
        HeroModel m = r.adaptTo(HeroModel.class);
        assertNotNull(m);
        assertEquals("Start your journey at AU", m.getHeading());
        assertEquals("Join Us", m.getCtaLabel());
        assertEquals("center", m.getAlign());
        assertTrue(m.isHasContent());
    }
}
