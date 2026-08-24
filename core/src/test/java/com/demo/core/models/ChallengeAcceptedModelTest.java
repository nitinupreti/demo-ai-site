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

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@ExtendWith(AemContextExtension.class)
class ChallengeAcceptedModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource r = context.create().resource("/content/test/ca",
                "sling:resourceType", "demo-ai-site/components/challenge-accepted");
        ChallengeAcceptedModel m = r.adaptTo(ChallengeAcceptedModel.class);
        assertNotNull(m);
        assertFalse(m.isHasContent());
        assertTrue(m.getCtas().isEmpty());
        assertTrue(m.getAudiences().isEmpty());
    }

    @Test
    void configuredFully() {
        Resource r = context.create().resource("/content/test/ca",
                "sling:resourceType", "demo-ai-site/components/challenge-accepted",
                "heading", "<p>Find your AU opportunity. <strong>Challenge accepted.</strong></p>",
                "audienceHeading", "Are you interested in...",
                "image", "/content/dam/demo-ai-site/design/clawed.jpg");
        context.create().resource(r.getPath() + "/ctas/c0", "label", "Apply", "link", "/x");
        context.create().resource(r.getPath() + "/audiences/a0", "label", "Undergraduate", "link", "/u");
        ChallengeAcceptedModel m = r.adaptTo(ChallengeAcceptedModel.class);
        assertNotNull(m);
        assertTrue(m.isHasContent());
        assertEquals(1, m.getCtas().size());
        assertEquals(1, m.getAudiences().size());
    }
}
