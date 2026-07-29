/*
 *  Copyright 2025 Adobe Systems Incorporated
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
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@ExtendWith(AemContextExtension.class)
class NewsHubModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        context.create().page("/content/test");
        Resource res = context.create().resource("/content/test/jcr:content/news",
                "sling:resourceType", "demo-ai-site/components/newshub");
        NewsHubModel model = res.adaptTo(NewsHubModel.class);
        assertNotNull(model);
        assertNull(model.getTitle());
        assertEquals("lg", model.getSectionPadding());
        assertEquals("cream", model.getBackgroundColor());
        assertNull(model.getBackgroundStyle());
        assertTrue(model.getItems().isEmpty());
        assertFalse(model.isHasContent());
    }

    @Test
    void configuredFully() {
        context.create().page("/content/test");
        Resource res = context.create().resource("/content/test/jcr:content/news",
                "sling:resourceType", "demo-ai-site/components/newshub",
                "title", "The latest news",
                "sectionPadding", "lg",
                "backgroundColor", "other",
                "hexColor", "#fbf9f6");
        context.create().resource(res.getPath() + "/items");
        context.create().resource(res.getPath() + "/items/item0",
                "size", "featured",
                "imagePath", "/content/dam/demo-ai-site/news/regional.jpg",
                "itemEyebrow", "2025 Regional Results",
                "itemTitle", "Lincoln Takes Home 1st place overall.",
                "itemDescription", "The team took home a stunning win.",
                "linkUrl", "/content/demo-ai-site/us/en/news/regional-2025");
        context.create().resource(res.getPath() + "/items/item1",
                "size", "regular",
                "itemEyebrow", "Upcoming event",
                "itemTitle", "6/11 Lunch Hour Pizza");
        context.create().resource(res.getPath() + "/items/item2",
                "size", "regular",
                "itemEyebrow", "Empty:"); // no title -> filtered

        NewsHubModel model = res.adaptTo(NewsHubModel.class);
        assertNotNull(model);
        assertEquals("The latest news", model.getTitle());
        assertEquals("other", model.getBackgroundColor());
        assertEquals("background-color: #fbf9f6;", model.getBackgroundStyle());
        assertEquals(2, model.getItems().size());
        assertEquals("featured", model.getItems().get(0).getSize());
        assertEquals("Lincoln Takes Home 1st place overall.", model.getItems().get(0).getItemTitle());
        assertEquals("regular", model.getItems().get(1).getSize());
        assertTrue(model.isHasContent());
    }
}
