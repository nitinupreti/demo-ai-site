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
class TeamModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource r = context.create().resource("/content/test/team-empty",
                new HashMap<String, Object>() {{ put("sling:resourceType", "demo-ai-site/components/pos-team"); }});
        TeamModel m = r.adaptTo(TeamModel.class);
        assertNotNull(m);
        assertFalse(m.isHasContent());
    }

    @Test
    void configuredFully() {
        Map<String, Object> parentProps = new HashMap<>();
        parentProps.put("sling:resourceType", "demo-ai-site/components/pos-team");
        parentProps.put("ctaText", "See all team");
        parentProps.put("ctaLink", "/content/team.html");
        Resource parent = context.create().resource("/content/test/team-full", parentProps);
        Resource members = context.create().resource(parent.getPath() + "/members", new HashMap<>());
        Map<String, Object> m1 = new HashMap<>();
        m1.put("name", "John Smith");
        m1.put("role", "CEO and Founder");
        m1.put("bio", "10+ years experience in digital marketing.");
        context.create().resource(members.getPath() + "/item0", m1);

        TeamModel model = parent.adaptTo(TeamModel.class);
        assertNotNull(model);
        assertTrue(model.isHasContent());
        assertEquals(1, model.getMembers().size());
        assertEquals("John Smith", model.getMembers().get(0).getName());
        assertEquals("See all team", model.getCtaText());
    }
}
