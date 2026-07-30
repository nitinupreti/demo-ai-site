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

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@ExtendWith(AemContextExtension.class)
class BlogListModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        context.create().page("/content/test");
        Resource res = context.create().resource("/content/test/jcr:content/blog",
                "sling:resourceType", "demo-ai-site/components/bloglist");
        BlogListModel model = res.adaptTo(BlogListModel.class);
        assertNotNull(model);
        assertNull(model.getTitle());
        assertEquals("3", model.getColumns());
        assertEquals("md", model.getSectionPadding());
        assertEquals("white", model.getBackgroundColor());
        assertNull(model.getBackgroundStyle());
        assertTrue(model.getItems().isEmpty());
        assertFalse(model.isHasContent());
    }

    @Test
    void configuredFully() {
        context.create().page("/content/test");
        Map<String, Object> props = new HashMap<>();
        props.put("sling:resourceType", "demo-ai-site/components/bloglist");
        props.put("title", "Caring is the new marketing");
        props.put("description", "The Nexcent blog is your source for insights.");
        props.put("columns", "3");
        props.put("sectionPadding", "md");
        props.put("backgroundColor", "other");
        props.put("hexColor", "#f5f7fa");
        Resource res = context.create().resource("/content/test/jcr:content/blog", props);
        context.create().resource(res.getPath() + "/items");
        context.create().resource(res.getPath() + "/items/item0",
                "title", "Creating Streamlined Safeguarding Processes with OneRen",
                "imagePath", "/content/dam/demo-ai-site/asset.jpg",
                "linkUrl", "#blog-1");
        context.create().resource(res.getPath() + "/items/item1",
                "title", "What are your safeguarding responsibilities?",
                "imagePath", "/content/dam/demo-ai-site/asset.jpg",
                "linkUrl", "#blog-2");
        context.create().resource(res.getPath() + "/items/item2",
                "linkUrl", "#missing-title");

        BlogListModel model = res.adaptTo(BlogListModel.class);
        assertNotNull(model);
        assertEquals("Caring is the new marketing", model.getTitle());
        assertEquals("other", model.getBackgroundColor());
        assertEquals("background-color: #f5f7fa;", model.getBackgroundStyle());
        assertEquals(2, model.getItems().size());
        assertTrue(model.isHasContent());
    }
}
