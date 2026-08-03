/*
 *  Copyright 2026 Adobe Systems Incorporated
 */
package com.demo.core.models;

import java.util.HashMap;
import java.util.Map;

import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import com.demo.core.testcontext.AppAemContext;

import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@ExtendWith(AemContextExtension.class)
class CtaBannerModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource r = context.create().resource("/content/test/cta-empty",
                new HashMap<String, Object>() {{ put("sling:resourceType", "demo-ai-site/components/pos-cta-banner"); }});
        CtaBannerModel m = r.adaptTo(CtaBannerModel.class);
        assertNotNull(m);
        assertFalse(m.isHasContent());
    }

    @Test
    void configuredFully() {
        Map<String, Object> p = new HashMap<>();
        p.put("sling:resourceType", "demo-ai-site/components/pos-cta-banner");
        p.put("title", "Let's make things happen");
        p.put("body", "Contact us today.");
        p.put("ctaText", "Get your free proposal");
        p.put("ctaLink", "/content/demo-ai-site/us/en/contact.html");
        p.put("illustration", "/content/dam/demo-ai-site/design/cta.png");
        Resource r = context.create().resource("/content/test/cta-full", p);
        CtaBannerModel m = r.adaptTo(CtaBannerModel.class);
        assertNotNull(m);
        assertEquals("Let's make things happen", m.getTitle());
        assertEquals("Get your free proposal", m.getCtaText());
        assertTrue(m.isHasContent());
    }
}
